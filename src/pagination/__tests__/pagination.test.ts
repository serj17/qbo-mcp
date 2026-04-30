import { describe, expect, it, vi } from "vitest";
import type { QboError, Result } from "../../qbo-client/index.js";
import {
  DEFAULT_PAGE_SIZE,
  FETCH_ALL_CAP,
  QBO_MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  paginate,
} from "../index.js";

const ok = <T>(value: T): Result<T, QboError> => ({ ok: true, value });
const err = (code: QboError["code"]): Result<never, QboError> => ({
  ok: false,
  error: { code, message: code, retryable: false },
});

interface FakePage<T> {
  fetchPage: ReturnType<typeof vi.fn>;
  fetchCount: ReturnType<typeof vi.fn>;
}

function fakeBackend<T>(
  rows: T[],
  options: { failOnPage?: number; failCount?: boolean } = {},
): FakePage<T> {
  const fetchPage = vi.fn(async (startPosition: number, max: number) => {
    if (options.failOnPage === startPosition) return err("QBO_SERVER_ERROR");
    const slice = rows.slice(startPosition - 1, startPosition - 1 + max);
    return ok(slice);
  });
  const fetchCount = vi.fn(async () => (options.failCount ? err("QBO_SERVER_ERROR") : ok(rows.length)));
  return { fetchPage, fetchCount };
}

describe("cursor encode/decode", () => {
  it("encodes STARTPOSITION to a base64url string", () => {
    expect(encodeCursor(101)).toBe(Buffer.from("101").toString("base64url"));
  });

  it("round-trips through encode/decode", () => {
    expect(decodeCursor(encodeCursor(1))).toBe(1);
    expect(decodeCursor(encodeCursor(101))).toBe(101);
    expect(decodeCursor(encodeCursor(99999))).toBe(99999);
  });

  it("decodes garbage to STARTPOSITION 1 (safe default)", () => {
    expect(decodeCursor("not-base64")).toBe(1);
    expect(decodeCursor("")).toBe(1);
  });
});

describe("paginate count_only", () => {
  it("issues only a count query and returns total_count with empty items", async () => {
    const rows = Array.from({ length: 47 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    const result = await paginate({ count_only: true }, backend);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      items: [],
      page_info: {
        total_count: 47,
        returned_count: 0,
        has_more: false,
        next_cursor: null,
      },
    });
    expect(backend.fetchCount).toHaveBeenCalledTimes(1);
    expect(backend.fetchPage).not.toHaveBeenCalled();
  });

  it("propagates fetchCount errors", async () => {
    const backend = fakeBackend([], { failCount: true });
    const result = await paginate({ count_only: true }, backend);
    expect(result.ok).toBe(false);
  });
});

describe("paginate first page", () => {
  it("runs count + page in parallel and includes total_count in page_info", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    const result = await paginate({ limit: 100 }, backend);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(100);
    expect(result.value.page_info).toMatchObject({
      total_count: 250,
      returned_count: 100,
      has_more: true,
    });
    expect(result.value.page_info.next_cursor).not.toBeNull();
    expect(backend.fetchCount).toHaveBeenCalledTimes(1);
    expect(backend.fetchPage).toHaveBeenCalledTimes(1);
    expect(backend.fetchPage).toHaveBeenCalledWith(1, 100);
  });

  it("sets has_more=false when the page is short of the limit", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    const result = await paginate({ limit: 100 }, backend);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.page_info.has_more).toBe(false);
    expect(result.value.page_info.next_cursor).toBeNull();
  });

  it("uses DEFAULT_PAGE_SIZE when no limit given", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    await paginate({}, backend);
    expect(backend.fetchPage).toHaveBeenCalledWith(1, DEFAULT_PAGE_SIZE);
  });

  it("clamps absurd limits to QBO_MAX_PAGE_SIZE", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    await paginate({ limit: 99999 }, backend);
    expect(backend.fetchPage).toHaveBeenCalledWith(1, QBO_MAX_PAGE_SIZE);
  });

  it("rejects negative / NaN limits, falls back to default", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    await paginate({ limit: -10 }, backend);
    expect(backend.fetchPage).toHaveBeenCalledWith(1, DEFAULT_PAGE_SIZE);
  });
});

describe("paginate with cursor (mid-pagination)", () => {
  it("skips the count query when a cursor is set", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    const cursor = encodeCursor(101);
    const result = await paginate({ limit: 100, cursor }, backend);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]).toEqual({ id: 101 });
    expect(result.value.page_info.total_count).toBeUndefined();
    expect(backend.fetchCount).not.toHaveBeenCalled();
    expect(backend.fetchPage).toHaveBeenCalledWith(101, 100);
  });

  it("computes the next cursor at startPosition + returned_count", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    const cursor = encodeCursor(101);
    const result = await paginate({ limit: 100, cursor }, backend);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeCursor(result.value.page_info.next_cursor!)).toBe(201);
  });
});

describe("paginate fetch_all", () => {
  it("loops until exhausted, accumulating all rows", async () => {
    const rows = Array.from({ length: 312 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    const result = await paginate({ fetch_all: true, limit: 100 }, backend);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(312);
    expect(result.value.page_info).toMatchObject({
      total_count: 312,
      returned_count: 312,
      has_more: false,
    });
    // 100 + 100 + 100 + 12 = 4 page requests
    expect(backend.fetchPage).toHaveBeenCalledTimes(4);
  });

  it("respects FETCH_ALL_CAP and signals truncation via has_more", async () => {
    const rows = Array.from({ length: 6000 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows);
    const result = await paginate({ fetch_all: true, limit: 1000 }, backend);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(FETCH_ALL_CAP);
    expect(result.value.page_info.has_more).toBe(true);
    expect(result.value.page_info.next_cursor).not.toBeNull();
    expect(result.value.page_info.total_count).toBe(6000);
  });

  it("propagates fetchPage errors mid-loop", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: i + 1 }));
    const backend = fakeBackend(rows, { failOnPage: 101 });
    const result = await paginate({ fetch_all: true, limit: 100 }, backend);
    expect(result.ok).toBe(false);
  });
});
