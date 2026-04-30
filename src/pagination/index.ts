import type { QboError, Result } from "../qbo-client/index.js";

/** QBO's per-page hard cap. */
export const QBO_MAX_PAGE_SIZE = 1000;
/** Default page size when callers don't specify a limit. */
export const DEFAULT_PAGE_SIZE = 100;
/** Hard cap on fetch_all to prevent runaway calls / context blowup. */
export const FETCH_ALL_CAP = 5000;

export interface PageInfo {
  /** Total matching rows across all pages. Undefined when not requested (e.g. mid-pagination). */
  total_count?: number;
  /** Items returned in this response. */
  returned_count: number;
  /** True when more rows exist beyond this page. */
  has_more: boolean;
  /** Opaque cursor for the next page; null when has_more is false. */
  next_cursor: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  page_info: PageInfo;
}

export interface PaginateOptions {
  /** Items per request page. Capped at QBO_MAX_PAGE_SIZE. Defaults to DEFAULT_PAGE_SIZE. */
  limit?: number;
  /** Opaque cursor from a prior page_info.next_cursor. */
  cursor?: string;
  /** Auto-paginate up to FETCH_ALL_CAP records, then stop with has_more=true. */
  fetch_all?: boolean;
  /** Skip the data query; return only { page_info: { total_count } }. */
  count_only?: boolean;
}

export interface PaginateDeps<T> {
  /**
   * Issue ONE page request. Caller plugs startPosition + maxResults into the
   * underlying query. Returns the items extracted from the QueryResponse.
   */
  fetchPage: (startPosition: number, maxResults: number) => Promise<Result<T[], QboError>>;
  /**
   * Issue a `SELECT COUNT(*) FROM ...` (or equivalent). Returns the total
   * matching the same filters. Used on first-page calls and count_only.
   */
  fetchCount: () => Promise<Result<number, QboError>>;
}

/** STARTPOSITION uses 1-based indexing per QBO's QBQL spec. */
const FIRST_START_POSITION = 1;

/**
 * Run a paginated query against QBO. Behaviour matrix:
 *
 *   count_only=true       -> single fetchCount; items=[].
 *   cursor set            -> single fetchPage from cursor; total_count omitted
 *                            (we're mid-pagination, no need to recount).
 *   fetch_all=true        -> loop fetchPage, accumulating up to FETCH_ALL_CAP;
 *                            also runs fetchCount once (so Claude can compare
 *                            returned_count vs total_count and notice when
 *                            the cap truncated).
 *   default (first page)  -> fetchCount + fetchPage in parallel; both included.
 *
 * Returns Result<PaginatedResult, QboError> — never throws for QBO failures.
 */
export async function paginate<T>(
  options: PaginateOptions,
  deps: PaginateDeps<T>,
): Promise<Result<PaginatedResult<T>, QboError>> {
  const limit = clampLimit(options.limit ?? DEFAULT_PAGE_SIZE);

  if (options.count_only) {
    const count = await deps.fetchCount();
    if (!count.ok) return count;
    return {
      ok: true,
      value: {
        items: [],
        page_info: {
          total_count: count.value,
          returned_count: 0,
          has_more: false,
          next_cursor: null,
        },
      },
    };
  }

  if (options.fetch_all) {
    return fetchAll(limit, deps);
  }

  const startPosition = options.cursor ? decodeCursor(options.cursor) : FIRST_START_POSITION;
  const isFirstPage = startPosition === FIRST_START_POSITION && !options.cursor;

  // Run count + page in parallel on first call, sequentially otherwise.
  const [pageResult, countResult] = await Promise.all([
    deps.fetchPage(startPosition, limit),
    isFirstPage ? deps.fetchCount() : Promise.resolve({ ok: true as const, value: undefined }),
  ]);

  if (!pageResult.ok) return pageResult;
  if (countResult && !countResult.ok) return countResult;

  const items = pageResult.value;
  const totalCount = countResult.ok ? (countResult.value as number | undefined) : undefined;
  const hasMore = items.length === limit && (totalCount === undefined || startPosition + items.length - 1 < totalCount);

  return {
    ok: true,
    value: {
      items,
      page_info: {
        ...(totalCount !== undefined ? { total_count: totalCount } : {}),
        returned_count: items.length,
        has_more: hasMore,
        next_cursor: hasMore ? encodeCursor(startPosition + items.length) : null,
      },
    },
  };
}

async function fetchAll<T>(
  limit: number,
  deps: PaginateDeps<T>,
): Promise<Result<PaginatedResult<T>, QboError>> {
  const accumulated: T[] = [];
  let startPosition = FIRST_START_POSITION;
  let truncated = false;

  // Run the count up front so Claude can see in the result whether the cap
  // hid rows. We don't fail the call if count fails — it's informational.
  const countResult = await deps.fetchCount();
  const totalCount = countResult.ok ? countResult.value : undefined;

  while (accumulated.length < FETCH_ALL_CAP) {
    const remaining = FETCH_ALL_CAP - accumulated.length;
    const requestLimit = Math.min(limit, remaining);
    const pageResult = await deps.fetchPage(startPosition, requestLimit);
    if (!pageResult.ok) return pageResult;
    const items = pageResult.value;
    accumulated.push(...items);
    if (items.length < requestLimit) break; // no more rows
    startPosition += items.length;
    if (accumulated.length >= FETCH_ALL_CAP) {
      truncated = totalCount === undefined ? true : accumulated.length < totalCount;
      break;
    }
  }

  return {
    ok: true,
    value: {
      items: accumulated,
      page_info: {
        ...(totalCount !== undefined ? { total_count: totalCount } : {}),
        returned_count: accumulated.length,
        has_more: truncated,
        next_cursor: truncated ? encodeCursor(FIRST_START_POSITION + accumulated.length) : null,
      },
    },
  };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(limit), QBO_MAX_PAGE_SIZE);
}

/**
 * Cursor format: opaque base64 of the STARTPOSITION integer. Opaque so callers
 * (Claude) treat it as a magic string rather than synthesizing one.
 */
export function encodeCursor(startPosition: number): string {
  return Buffer.from(String(startPosition), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const n = Number.parseInt(decoded, 10);
    if (!Number.isFinite(n) || n < 1) return FIRST_START_POSITION;
    return n;
  } catch {
    return FIRST_START_POSITION;
  }
}
