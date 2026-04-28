## Parent

#1

## What to build

The `logger` deep module: a `pino` instance configured with two sinks (file + stderr), JSON-line format, redaction for token-shaped values, and log-path resolution via `env-paths`. Plus a `readRecentLogs({lines, level?, tool?})` reader that tails the log file, parses JSON lines, applies filters, and returns structured entries — used by the `get_recent_logs` MCP tool so Claude can self-diagnose past failures.

Also registers the `get_recent_logs` MCP tool with the running server (added to the `ping`-only server from #2).

## Acceptance criteria

- [ ] `pino` writes to `<config-dir>/logs/qbo-mcp.log` (auto-created if missing) and to stderr
- [ ] Log path is printed to stderr on server startup
- [ ] Log files rotate at 5 MB, keep 5 generations
- [ ] Logs flush synchronously enough that `pino.flush()` after each write keeps the file consistent across crashes
- [ ] Redaction config strips fields named `access_token`, `refresh_token`, `client_secret`, `Authorization`, `code`, plus their nested variants
- [ ] `LOG_LEVEL` env var controls verbosity (default `info`, accepts `debug`, `warn`, `error`)
- [ ] `readRecentLogs({lines, level?, tool?})` reads the tail of the file, parses JSON, applies filters, returns array of entries
- [ ] `get_recent_logs` MCP tool exposes `readRecentLogs` with a Zod schema (`lines: number, level?: string, tool?: string`)
- [ ] Unit tests cover `readRecentLogs` filter logic over fixture log files (lines limit, level filter, tool filter, malformed line handling)

## Blocked by

- Blocked by #2
