import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentCache } from "../index.js";

describe("AttachmentCache", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "qbo-mcp-att-cache-"));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  describe("lookup", () => {
    it("returns null when nothing has been stored", () => {
      const cache = new AttachmentCache({ cacheDir });
      expect(cache.lookup("does-not-exist")).toBeNull();
    });

    it("returns null when meta file is corrupted", () => {
      const cache = new AttachmentCache({ cacheDir });
      cache.store("42", { fileName: "x.pdf", contentType: "application/pdf", size: 3 }, Buffer.from("PDF"));
      // Corrupt the meta JSON
      const fs = require("node:fs") as typeof import("node:fs");
      fs.writeFileSync(join(cacheDir, "42.meta.json"), "{ broken json", "utf8");
      expect(cache.lookup("42")).toBeNull();
    });
  });

  describe("store + lookup round-trip", () => {
    it("persists data and metadata, lookup returns the same values", () => {
      const cache = new AttachmentCache({ cacheDir });
      const data = Buffer.from("%PDF-fake-content");
      const stored = cache.store(
        "att-1",
        { fileName: "receipt.pdf", contentType: "application/pdf", size: data.length },
        data,
      );

      expect(stored.fileName).toBe("receipt.pdf");
      expect(stored.contentType).toBe("application/pdf");
      expect(stored.size).toBe(data.length);
      expect(existsSync(stored.localPath)).toBe(true);
      expect(readFileSync(stored.localPath)).toEqual(data);

      const looked = cache.lookup("att-1");
      expect(looked).toEqual(stored);
    });

    it("auto-creates the cache directory on first store", () => {
      const nested = join(cacheDir, "deeper", "still");
      const cache = new AttachmentCache({ cacheDir: nested });
      cache.store("att-2", { fileName: "x.pdf", contentType: "application/pdf", size: 3 }, Buffer.from("PDF"));
      expect(existsSync(nested)).toBe(true);
    });

    it("sanitizes pathological filenames so the on-disk path stays inside cacheDir", () => {
      const cache = new AttachmentCache({ cacheDir });
      const stored = cache.store(
        "att-3",
        { fileName: "../etc/passwd\x00.pdf", contentType: "application/pdf", size: 1 },
        Buffer.from("X"),
      );
      // localPath must resolve to a file directly inside cacheDir — no path traversal
      const parent = join(stored.localPath, "..");
      expect(parent).toBe(cacheDir);
      // The stored fileName metadata is preserved verbatim — only the on-disk filename is sanitized
      expect(stored.fileName).toBe("../etc/passwd\x00.pdf");
    });
  });

  describe("LRU eviction", () => {
    it("evicts the oldest entries by mtime once total size exceeds maxBytes", async () => {
      const cache = new AttachmentCache({ cacheDir, maxBytes: 100 });

      // Store three 50-byte files; after the third, total = 150 > 100, oldest must be evicted.
      cache.store("a", { fileName: "a.bin", contentType: "application/octet-stream", size: 50 }, Buffer.alloc(50, "a"));
      // Force ordering so mtimes are distinguishable on filesystems with second-resolution mtimes.
      await new Promise((r) => setTimeout(r, 20));
      cache.store("b", { fileName: "b.bin", contentType: "application/octet-stream", size: 50 }, Buffer.alloc(50, "b"));
      await new Promise((r) => setTimeout(r, 20));
      cache.store("c", { fileName: "c.bin", contentType: "application/octet-stream", size: 50 }, Buffer.alloc(50, "c"));

      // 'a' is the oldest — should be gone.
      expect(cache.lookup("a")).toBeNull();
      // 'b' and 'c' are within the cap.
      expect(cache.lookup("b")).not.toBeNull();
      expect(cache.lookup("c")).not.toBeNull();
    });

    it("does not evict when total size is within the cap", () => {
      const cache = new AttachmentCache({ cacheDir, maxBytes: 1000 });
      cache.store("a", { fileName: "a.bin", contentType: "application/octet-stream", size: 100 }, Buffer.alloc(100, "a"));
      cache.store("b", { fileName: "b.bin", contentType: "application/octet-stream", size: 100 }, Buffer.alloc(100, "b"));
      expect(cache.lookup("a")).not.toBeNull();
      expect(cache.lookup("b")).not.toBeNull();
    });

    it("honors ATTACHMENT_CACHE_MAX_BYTES env var when no explicit maxBytes is passed", async () => {
      const cache = new AttachmentCache({ cacheDir, env: { ATTACHMENT_CACHE_MAX_BYTES: "100" } });
      cache.store("a", { fileName: "a.bin", contentType: "application/octet-stream", size: 50 }, Buffer.alloc(50, "a"));
      await new Promise((r) => setTimeout(r, 20));
      cache.store("b", { fileName: "b.bin", contentType: "application/octet-stream", size: 50 }, Buffer.alloc(50, "b"));
      await new Promise((r) => setTimeout(r, 20));
      cache.store("c", { fileName: "c.bin", contentType: "application/octet-stream", size: 50 }, Buffer.alloc(50, "c"));
      expect(cache.lookup("a")).toBeNull();
    });
  });

  describe("idempotent re-storage", () => {
    it("re-storing the same id updates the metadata and the data file", () => {
      const cache = new AttachmentCache({ cacheDir });
      cache.store("x", { fileName: "v1.pdf", contentType: "application/pdf", size: 3 }, Buffer.from("v1A"));
      cache.store("x", { fileName: "v2.pdf", contentType: "application/pdf", size: 3 }, Buffer.from("v2B"));
      const looked = cache.lookup("x");
      expect(looked?.fileName).toBe("v2.pdf");
      expect(readFileSync(looked!.localPath, "utf8")).toBe("v2B");
    });
  });
});
