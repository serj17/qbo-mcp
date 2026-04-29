import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import envPaths from "env-paths";
import pino, { type Logger, type LoggerOptions } from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /** ISO timestamp */
  time: string;
  /** Pino numeric level translated back to a string */
  level: LogLevel;
  /** Tool name when this entry was emitted from a tool call, undefined otherwise */
  tool?: string;
  /** Human-readable message */
  msg: string;
  /** Any other structured fields the call attached */
  [key: string]: unknown;
}

export interface ReadRecentLogsFilters {
  lines: number;
  level?: LogLevel;
  tool?: string;
}

export interface LoggerPaths {
  logDir: string;
  logFile: string;
}

export interface LoggerOptionsOverride {
  /** Override the env-paths-derived log dir. Used by tests. */
  logDir?: string;
  /** Override env-var lookup. Used by tests. */
  env?: NodeJS.ProcessEnv;
}

const PATHS_NAME = "qbo-mcp";
const FILE_NAME = "qbo-mcp.log";

export function getLoggerPaths(options: LoggerOptionsOverride = {}): LoggerPaths {
  const logDir = options.logDir ?? envPaths(PATHS_NAME, { suffix: "" }).log;
  return { logDir, logFile: join(logDir, FILE_NAME) };
}

const REDACT_PATHS = [
  "access_token",
  "refresh_token",
  "client_secret",
  "authorization",
  "Authorization",
  "code",
  "*.access_token",
  "*.refresh_token",
  "*.client_secret",
  "*.authorization",
  "*.Authorization",
  "*.code",
  "tokens.access_token",
  "tokens.refresh_token",
  "app_credentials.client_secret",
  "headers.authorization",
  "headers.Authorization",
  "request.headers.authorization",
  "request.headers.Authorization",
];

const LEVEL_NAMES: Record<number, LogLevel> = {
  10: "debug",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "error",
};

function resolveLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.LOG_LEVEL?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

let cachedLogger: Logger | undefined;
let cachedPaths: LoggerPaths | undefined;

/**
 * Build (and cache) the singleton logger. Subsequent calls return the same
 * instance. Call resetLogger() in tests to drop the cache.
 *
 * Writes to two destinations via pino's transport worker:
 *   - stderr (so Claude Code surfaces logs in its MCP debug panel)
 *   - <log-dir>/qbo-mcp.log with size-based rotation (5 MB x 5 generations)
 */
export function getLogger(options: LoggerOptionsOverride = {}): Logger {
  if (cachedLogger) return cachedLogger;
  const env = options.env ?? process.env;
  const paths = getLoggerPaths(options);
  mkdirSync(paths.logDir, { recursive: true });
  const level = resolveLevel(env);

  const opts: LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]", remove: false },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    transport: {
      targets: [
        { target: "pino/file", level, options: { destination: 2, sync: false } },
        {
          target: "pino-roll",
          level,
          options: {
            file: paths.logFile,
            size: "5m",
            limit: { count: 5 },
            mkdir: true,
          },
        },
      ],
    },
  };

  cachedLogger = pino(opts);
  cachedPaths = paths;
  return cachedLogger;
}

export function getCachedPaths(): LoggerPaths | undefined {
  return cachedPaths;
}

/** For tests only — drop the cached singleton so getLogger() rebuilds. */
export function resetLogger(): void {
  if (cachedLogger) {
    try {
      cachedLogger.flush();
    } catch {
      // best-effort
    }
  }
  cachedLogger = undefined;
  cachedPaths = undefined;
}

/**
 * Read the tail of the log file, parse JSON-line entries, apply filters,
 * and return them most-recent-first.
 *
 * Designed for the get_recent_logs MCP tool — Claude reads its own past
 * tool calls to diagnose failures.
 */
export function readRecentLogs(
  filters: ReadRecentLogsFilters,
  options: LoggerOptionsOverride = {},
): LogEntry[] {
  const paths = getLoggerPaths(options);
  let raw: string;
  try {
    statSync(paths.logFile);
    raw = readFileSync(paths.logFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const lines = raw.split(/\r?\n/);
  const entries: LogEntry[] = [];
  // Walk newest-to-oldest so we can stop early once we have `lines` matches.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const level = mapLevel(parsed.level);
    if (!level) continue;
    if (filters.level && level !== filters.level) continue;
    if (filters.tool && parsed.tool !== filters.tool) continue;
    entries.push({
      ...parsed,
      time: typeof parsed.time === "string" ? parsed.time : "",
      level,
      tool: typeof parsed.tool === "string" ? parsed.tool : undefined,
      msg: typeof parsed.msg === "string" ? parsed.msg : "",
    });
    if (entries.length >= filters.lines) break;
  }
  return entries;
}

function mapLevel(raw: unknown): LogLevel | undefined {
  if (typeof raw === "number") return LEVEL_NAMES[raw];
  if (typeof raw === "string") {
    const lc = raw.toLowerCase();
    if (lc === "debug" || lc === "info" || lc === "warn" || lc === "error") return lc;
  }
  return undefined;
}

/**
 * Synchronously append one raw JSON line to the log file. Used by the unit
 * tests to set up deterministic fixture state without spinning up the pino
 * transport worker. Production code paths go through getLogger() instead.
 */
export function appendRawLogLine(line: string, options: LoggerOptionsOverride = {}): void {
  const paths = getLoggerPaths(options);
  mkdirSync(paths.logDir, { recursive: true });
  const fd = openSync(paths.logFile, "a", 0o600);
  try {
    const buf = Buffer.from(line.endsWith("\n") ? line : `${line}\n`, "utf8");
    writeSync(fd, buf);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
