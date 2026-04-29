## Parent

#1

## What to build

The `logger` deep module: a `pino` instance configured with two sinks (file + stderr), JSON-line format, redaction for token-shaped values, and log-path resolution via `env-paths`. Plus a `readRecentLogs({lines, level?, tool?})` reader that tails the log file, parses JSON lines, applies filters, and returns structured entries — used by the `get_recent_logs` MCP tool so Claude can self-diagnose past failures.

Also registers the `get_recent_logs` MCP tool with the running server (added to the `ping`-only server from #2).

## Acceptance criteria

- [x] `pino` writes to `<config-dir>/logs/qbo-mcp.log` (auto-created if missing) and to stderr
- [x] Log path is printed to stderr on server startup
- [x] Log files rotate at 5 MB, keep 5 generations
- [x] Logs flush synchronously enough that `pino.flush()` after each write keeps the file consistent across crashes
- [x] Redaction config strips fields named `access_token`, `refresh_token`, `client_secret`, `Authorization`, `code`, plus their nested variants
- [x] `LOG_LEVEL` env var controls verbosity (default `info`, accepts `debug`, `warn`, `error`)
- [x] `readRecentLogs({lines, level?, tool?})` reads the tail of the file, parses JSON, applies filters, returns array of entries
- [x] `get_recent_logs` MCP tool exposes `readRecentLogs` with a Zod schema (`lines: number, level?: string, tool?: string`)
- [x] Unit tests cover `readRecentLogs` filter logic over fixture log files (lines limit, level filter, tool filter, malformed line handling)

## Blocked by

- Blocked by #2
