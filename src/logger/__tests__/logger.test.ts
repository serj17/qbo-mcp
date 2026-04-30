import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRawLogLine, getLoggerPaths, readRecentLogs } from "../index.js";

function ts(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 3, 28, 12, 0, offsetSeconds)).toISOString();
}

function logLine(entry: Record<string, unknown>): string {
  return JSON.stringify(entry);
}

describe("logger", () => {
  let logDir: string;

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), "qbo-mcp-log-"));
  });

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  describe("getLoggerPaths", () => {
    it("derives logFile from the resolved log dir", () => {
      const paths = getLoggerPaths({ logDir });
      expect(paths.logDir).toBe(logDir);
      expect(paths.logFile).toBe(join(logDir, "qbo-mcp.log"));
    });

    it("honors QBO_MCP_CONFIG_DIR env var when no explicit logDir is passed", () => {
      const paths = getLoggerPaths({ env: { QBO_MCP_CONFIG_DIR: logDir } });
      expect(paths.logDir).toBe(logDir);
      expect(paths.logFile).toBe(join(logDir, "qbo-mcp.log"));
    });
  });

  describe("readRecentLogs with no log file", () => {
    it("returns empty array when the file does not exist", () => {
      const entries = readRecentLogs({ lines: 50 }, { logDir });
      expect(entries).toEqual([]);
    });
  });

  describe("readRecentLogs with content", () => {
    beforeEach(() => {
      appendRawLogLine(logLine({ level: 30, time: ts(0), msg: "startup" }), { logDir });
      appendRawLogLine(logLine({ level: 30, time: ts(1), tool: "list_invoices", msg: "tool ok", duration_ms: 312 }), { logDir });
      appendRawLogLine(logLine({ level: 50, time: ts(2), tool: "qbo_query", msg: "INVALID_QUERY", code: "INVALID_QUERY" }), { logDir });
      appendRawLogLine(logLine({ level: 40, time: ts(3), tool: "list_customers", msg: "rate limited" }), { logDir });
      appendRawLogLine(logLine({ level: 30, time: ts(4), tool: "list_invoices", msg: "tool ok", duration_ms: 198 }), { logDir });
    });

    it("returns entries newest-first", () => {
      const entries = readRecentLogs({ lines: 50 }, { logDir });
      expect(entries.map((e) => e.time)).toEqual([ts(4), ts(3), ts(2), ts(1), ts(0)]);
    });

    it("limits the result to the requested lines count", () => {
      const entries = readRecentLogs({ lines: 2 }, { logDir });
      expect(entries.map((e) => e.time)).toEqual([ts(4), ts(3)]);
    });

    it("filters by level", () => {
      const errors = readRecentLogs({ lines: 50, level: "error" }, { logDir });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ level: "error", code: "INVALID_QUERY" });

      const warns = readRecentLogs({ lines: 50, level: "warn" }, { logDir });
      expect(warns).toHaveLength(1);
      expect(warns[0]).toMatchObject({ level: "warn", tool: "list_customers" });
    });

    it("filters by tool name", () => {
      const entries = readRecentLogs({ lines: 50, tool: "list_invoices" }, { logDir });
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.duration_ms)).toEqual([198, 312]);
    });

    it("combines level and tool filters", () => {
      const entries = readRecentLogs({ lines: 50, level: "error", tool: "qbo_query" }, { logDir });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ tool: "qbo_query", level: "error" });
    });

    it("translates numeric pino levels back to string level names", () => {
      const entries = readRecentLogs({ lines: 50 }, { logDir });
      const levels = entries.map((e) => e.level);
      expect(levels).toEqual(["info", "warn", "error", "info", "info"]);
    });

    it("preserves arbitrary structured fields on each entry", () => {
      const entries = readRecentLogs({ lines: 50, tool: "list_invoices" }, { logDir });
      expect(entries[0]).toMatchObject({ duration_ms: 198, msg: "tool ok" });
    });
  });

  describe("readRecentLogs malformed-line tolerance", () => {
    beforeEach(() => {
      appendRawLogLine(logLine({ level: 30, time: ts(0), msg: "ok" }), { logDir });
      // Append a non-JSON line directly to the file
      writeFileSync(getLoggerPaths({ logDir }).logFile, "this is not json\n", { flag: "a" });
      appendRawLogLine(logLine({ level: 50, time: ts(2), tool: "qbo_query", msg: "fail" }), { logDir });
    });

    it("skips unparseable lines without throwing", () => {
      const entries = readRecentLogs({ lines: 50 }, { logDir });
      expect(entries.map((e) => e.msg)).toEqual(["fail", "ok"]);
    });

    it("skips entries with unrecognized level values", () => {
      appendRawLogLine(logLine({ level: "weird", time: ts(3), msg: "no level" }), { logDir });
      appendRawLogLine(logLine({ time: ts(4), msg: "missing level entirely" }), { logDir });
      const entries = readRecentLogs({ lines: 50 }, { logDir });
      expect(entries).toHaveLength(2);
    });
  });
});
