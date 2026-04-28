## Parent

#1

## What to build

The self-healing surface: the `doctor` deep module, the `doctor` MCP tool, the `npx qbo-mcp doctor` CLI subcommand, and the startup self-check that runs every time the MCP server boots.

`doctor.runDoctor()` returns a structured `DoctorReport` composed from the other modules: auth status (ok / expired / missing) with `expires_in_seconds`, QBO reachability (one cheap `get_company_info` ping), realm_id, environment, last API call summary (from logs), last error (from logs), config and log paths, version. Used by both the MCP tool and the CLI.

Startup self-check runs in this order on every server boot: config readable → tokens present → tokens not expired → `get_company_info` succeeds against QBO. Failures log a clear remediation message; missing/expired tokens cause the server to exit cleanly with code 1 and an actionable message on stderr (instead of starting and failing on every tool call).

## Acceptance criteria

- [ ] `doctor.runDoctor()` returns the documented `DoctorReport` shape with all fields populated
- [ ] `auth.status` is one of `ok | expired | missing`; `expires_in_seconds` is null when not `ok`
- [ ] `last_api_call` and `last_error` are sourced from the log file via `logger.readRecentLogs`
- [ ] `doctor` MCP tool returns the report as JSON in a single `text` content block
- [ ] `npx qbo-mcp doctor` CLI prints the same report human-readable (table or pretty JSON), exit code 0 if all green, 1 if any check fails
- [ ] Startup self-check sequence runs before the server begins listening on stdio
- [ ] Missing config exits with code 1 and a stderr message naming the exact command to run (`npx qbo-mcp auth --env <env>`)
- [ ] Expired refresh token exits with code 1 and the same remediation
- [ ] QBO reachability failure logs a warning but does NOT exit (server still starts so Claude can see the error via tools)
- [ ] Each MCP tool failure is independent — a broken tool doesn't kill the server process

## Blocked by

- Blocked by #8
