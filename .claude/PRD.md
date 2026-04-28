## Problem Statement

I work across 1-3 devices weekly and frequently need to ask questions about my QuickBooks Online data — "what was revenue last quarter?", "who are my top customers?", "are there any duplicate vendors?", "what's on the receipt PDF attached to this bill?". The QBO web UI requires manual navigation per question, doesn't let me cross-reference data the way I think about it, and gives me no help spotting bookkeeping anomalies. I want to ask Claude these questions in natural language and have it answer using my real QBO data, with the same install working consistently on every machine I use.

## Solution

A read-only Model Context Protocol (MCP) server, written in TypeScript and published to npm as `qbo-mcp`, that exposes ~21 QuickBooks Online tools for Claude to call. Single-tenant (just my QBO instance) but designed for easy install on any device via `npx -y qbo-mcp`. Authenticates per-device via browser-based OAuth. Hits the QBO sandbox during development and production once tools feel right. Includes self-healing primitives (a `doctor` tool, a `get_recent_logs` tool, structured errors with remediation hints) so Claude can diagnose and explain its own failures rather than dumping opaque stack traces.

The server never writes to QBO — read-only is enforced by simply not implementing any write tools, even though the OAuth scope technically permits writes.

## User Stories

### Install and authentication

1. As the operator, I want to install the server on any device with one command (`npx -y qbo-mcp`), so I can use it without remembering setup steps.
2. As the operator, I want to authenticate via my browser using a separate `auth` subcommand, so I don't have to copy-paste OAuth codes.
3. As the operator, I want a `--manual` fallback for the auth flow, so I can authenticate over SSH or in environments where the browser callback can't reach localhost.
4. As the operator, I want to switch between sandbox and production environments via an `--env` flag on the auth command, so I can develop safely without touching real data.
5. As the operator, I want my OAuth tokens stored at the OS-appropriate path (`%APPDATA%\qbo-mcp\` on Windows, `~/Library/Application Support/qbo-mcp/` on macOS, `~/.config/qbo-mcp/` on Linux), so each device manages its own credentials.
6. As the operator, I want app credentials (`client_id` / `client_secret`) readable from env vars with the config file as fallback, so I can keep them out of files when I want to.
7. As the operator, I want my access tokens auto-refreshed silently when they expire (every hour), so I'm never interrupted mid-conversation by expiry.
8. As the operator, I want clear actionable error messages when my refresh token expires (after 100 days), telling me exactly which command to run, so I know what to do.
9. As the operator, I want to verify a fresh install works via `npx qbo-mcp doctor`, so I can catch setup problems before they hit Claude.

### Ad-hoc Q&A

10. As the operator, I want to ask Claude "what was my revenue last quarter?" and get a P&L answer, so I get financials without leaving Claude.
11. As the operator, I want to ask Claude "show me my balance sheet as of today", so I can see my current financial position.
12. As the operator, I want to ask Claude "who are my top 10 customers by AR?", so I can identify high-value relationships.
13. As the operator, I want to ask Claude "show me unpaid invoices over 30 days old", so I can chase receivables without manually filtering in the QBO UI.
14. As the operator, I want to ask Claude "what's my A/R aging look like?", so I can prioritize collections by bucket.
15. As the operator, I want to ask Claude "what bills are coming due?", so I can plan payments.
16. As the operator, I want to ask Claude "what hit account X between dates Y and Z?", so I can audit general ledger activity.
17. As the operator, I want to ask Claude "how many invoices match these filters?" and get just a count, so I can scope a question before pulling all the data.
18. As the operator, I want to ask follow-up questions in the same conversation that drill into specific records, so I can explore data interactively rather than running fixed reports.

### Bookkeeping anomaly detection

19. As the operator, I want Claude to scan my vendor list for likely duplicates (similar names, same EIN), so I can clean up vendor records.
20. As the operator, I want Claude to find transactions hitting unusual accounts, so I can spot misclassifications.
21. As the operator, I want Claude to find invoices missing customer references, categories, or dates, so I can fix data-quality gaps.
22. As the operator, I want Claude to compare two periods and flag accounts with unusual movement, so I can spot bookkeeping errors before they compound.
23. As the operator, I want anomaly-detection workflows to be open-ended Claude reasoning — not a fixed checklist — so I can describe new types of issues in plain language and have Claude figure out the queries.

### PDF and attachment access

24. As the operator, I want Claude to list which records have attachments, so I know which bills/invoices have backing documentation.
25. As the operator, I want Claude to read PDFs attached to bills, so I can get receipt details from the file content (vendor, line items, totals).
26. As the operator, I want attachment downloads cached locally, so re-reading the same PDF in the same session doesn't re-download from QBO.
27. As the operator, I want the attachment cache to evict old files automatically, so it doesn't grow unbounded on disk.

### Tool ergonomics for Claude

28. As Claude, I want a small set of high-level report tools (P&L, Balance Sheet, A/R Aging, A/P Aging, General Ledger), so I can answer common questions without knowing QBO API specifics.
29. As Claude, I want entity-list tools (`list_invoices`, `list_customers`, `list_vendors`, `list_bills`, `list_accounts`, `list_transactions`) with structured filter schemas, so I can narrow results before paginating.
30. As Claude, I want detail tools (`get_invoice`, `get_customer`, `get_vendor`, `get_bill`) that return the full nested entity, so I can answer specific questions about one record.
31. As Claude, I want a default page size of 100 on list tools, so I don't blow up the user's context with casual questions.
32. As Claude, I want a `count_only` mode on list tools, so I can answer "how many X" cheaply.
33. As Claude, I want a `fetch_all` mode on list tools (capped at 5000), so I can scan the whole dataset for anomaly detection without writing a pagination loop.
34. As Claude, I want pagination via opaque `cursor` strings in `page_info`, so I can read through large result sets predictably across calls.
35. As Claude, I want every list response to include `total_count`, `returned_count`, `has_more`, and `next_cursor`, so I can communicate scale to the user and continue paginating.
36. As Claude, I want a raw QBQL `qbo_query` escape hatch tool, so I can answer questions the curated tools don't cover.
37. As Claude, I want a `get_company_info` tool that returns legal name, fiscal year start, and currency, so I can orient myself at the start of a conversation.

### Self-diagnosis

38. As Claude, I want a `doctor` tool that returns a structured health report (auth status, token expiry, QBO reachability, last API call, last error, config and log paths, version), so I can diagnose problems without asking the user to inspect anything.
39. As Claude, I want a `get_recent_logs` tool that returns the tail of the structured log file with optional filtering by level and tool name, so I can investigate why a previous call failed in the same conversation.
40. As Claude, I want errors returned as structured tool results with `isError: true`, an `_meta.code`, and a human-readable remediation message, so I can suggest specific fixes to the user (e.g., "your QBO auth has expired, please run npx qbo-mcp auth").
41. As Claude, I want each tool call to fail independently — a broken `qbo_query` shouldn't take down the server — so I can keep working on the rest of the conversation even when one tool errors.
42. As the operator, I want a `npx qbo-mcp doctor` CLI command (mirroring the MCP tool) that I can run from a terminal, so I can verify server health without spinning up Claude.

### Logging and observability

43. As the operator, I want every tool call logged with the tool name, input args (with token-shaped values redacted), QBO request URL, response status, response excerpt, duration, and any error code + stack, so I can audit what Claude actually did.
44. As the operator, I want logs stored as JSON lines in a predictable file path (`<config-dir>/logs/qbo-mcp.log`), so I can grep or share them when something goes wrong.
45. As the operator, I want the log path printed on server startup, so I always know where to look.
46. As the operator, I want logs rotated automatically (e.g., 5 MB × 5 files), so the log directory doesn't grow unbounded.
47. As the operator, I want logs flushed on every write, so they survive crashes.
48. As the operator, I want a `LOG_LEVEL` env var so I can bump verbosity to `debug` when needed without restarting Claude.

### Robustness

49. As the operator, I want startup self-checks (config readable, tokens present, tokens not expired, `get_company_info` succeeds) to log clear remediation messages, so install issues are obvious immediately.
50. As the operator, I want corrupted config files backed up as `tokens.json.bak.<timestamp>` before being replaced, so I never silently lose state.
51. As the operator, I want token-file writes to be atomic (temp-file-and-rename), so a crash mid-write never leaves a corrupted file.
52. As the operator, I want the server to never write to my QBO data under any circumstances, so I cannot accidentally corrupt my books even if Claude misuses a tool.

## Implementation Decisions

### Stack and distribution

- **Language and runtime:** TypeScript on Node.js (>= 20).
- **Core libraries:** `@modelcontextprotocol/sdk` (MCP server framework), `node-quickbooks` (QBO API wrapper), `intuit-oauth` (official Intuit OAuth client), `pino` (structured logging), `env-paths` (OS-appropriate config/cache/log dirs), `zod` (tool input validation), `vitest` (testing).
- **Transport:** stdio only. The MCP server runs as a subprocess of the Claude client.
- **Distribution:** public npm package `qbo-mcp` (verified available). Install on any device via `npx -y qbo-mcp`.
- **CLI subcommands:** `auth` (browser-callback OAuth, with `--manual` and `--env sandbox|production` flags), `doctor` (health check), default (run MCP server). A `reset` subcommand exists but is intentionally CLI-only — never exposed as an MCP tool.

### Architecture: deep modules

The codebase is organized around eight deep modules. Each one hides a meaningful piece of complexity behind a small interface.

- **`config-store`** — atomic read/write of tokens and app credentials. Hides filesystem operations, env-var-vs-file precedence, and corruption-recovery (backup-and-replace on invalid JSON).
- **`auth-flow`** — browser-based OAuth ceremony. Hides the local HTTP listener, OAuth state-param handling, code exchange, and the `--manual` fallback path.
- **`qbo-client`** — thin layer over `node-quickbooks` + `intuit-oauth` that adds silent access-token refresh on 401, retry-once policy, error normalization to a single `QboError` shape, and structured request/response logging. The deepest module — every QBO API quirk is contained here, and everything above is QBO-agnostic.
- **`pagination`** — cursor encode/decode, count query, `fetch_all` coordinator with hard cap. The single source of truth for the list-tool result shape (`{ items, page_info: { total_count, returned_count, has_more, next_cursor } }`).
- **`logger`** — pino setup with file + stderr sinks, redaction config, log-path resolution. Plus a `readRecentLogs({lines, level?, tool?})` reader used by the `get_recent_logs` MCP tool.
- **`tool-registry`** — wraps `(name, zodSchema, handler)` into a registered MCP tool with automatic logging, error mapping, and (for list tools) pagination. Removes ~700 lines of repeated boilerplate across the 21 tools.
- **`doctor`** — composes the others to produce a `DoctorReport`. Used by both the `doctor` MCP tool and the `npx qbo-mcp doctor` CLI subcommand.
- **`attachment-cache`** — local file cache for downloaded PDFs with LRU eviction by total-size cap. Hides QBO's signed-URL download dance.

### Tool surface (~21 MCP tools)

- **Reports (5):** `get_profit_and_loss`, `get_balance_sheet`, `get_ar_aging_summary`, `get_ap_aging_summary`, `get_general_ledger`.
- **Entity lists (6):** `list_invoices`, `list_customers`, `list_vendors`, `list_bills`, `list_accounts`, `list_transactions`. Each takes typed filters plus pagination params (`limit`, `cursor`, `fetch_all`, `count_only`).
- **Detail fetchers (4):** `get_invoice`, `get_customer`, `get_vendor`, `get_bill`.
- **Attachments (2):** `list_attachments(entity_type, entity_id)` returns metadata; `get_attachment(attachment_id)` downloads to local cache and returns the file path. Claude reads the PDF via its native Read tool.
- **Escape hatch (1):** `qbo_query(qbql_string)` for cases the curated tools don't cover.
- **Meta (1):** `get_company_info()` — cached for the lifetime of the server process.
- **Self-diagnosis (2):** `doctor()` returns the structured health report; `get_recent_logs({lines?, level?, tool?})` returns parsed JSON log lines.

### Pagination contract

Every list tool returns `{ items, page_info: { total_count, returned_count, has_more, next_cursor } }`. Default `limit = 100`, max `1000` (QBO's cap). `fetch_all: true` auto-paginates up to 5000 records and returns an error above that. `count_only: true` returns just `{ total_count: N }` for cheap scoping queries.

### Error contract

All tool errors are returned as MCP results with `isError: true`, an `_meta.code`, and a human-readable remediation message in the `text` content. Error codes include `AUTH_REFRESH_FAILED`, `RATE_LIMITED`, `NOT_FOUND`, `INVALID_INPUT`, `QBO_SERVER_ERROR`, `INVALID_QUERY`, `NETWORK_ERROR`. The text always includes a remediation hint so Claude can suggest precise fixes to the user.

### Auth and token lifecycle

- Access tokens (1h lifetime) are refreshed silently inside `qbo-client` on 401, with a single retry. Claude never sees these.
- Refresh tokens (100-day lifetime) are rotated on every refresh and persisted atomically. When a refresh fails, the next tool call returns `AUTH_REFRESH_FAILED` with a re-auth instruction.
- App credentials (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`) are read from env vars first, config file second.
- The `auth` subcommand stores tokens, realm/company ID, and environment (`sandbox` | `production`) together in a single config file.

### Caching

None at the QBO-response level, except `get_company_info` which is cached for the lifetime of the server process. Attachment downloads are cached on disk by `attachment-cache`.

### Self-healing

- Startup self-check sequence: config readable -> tokens present -> tokens not expired -> `get_company_info` succeeds. Each step logs a clear remediation message on failure; missing/expired tokens cause the server to exit cleanly with exit code 1 and an actionable message on stderr.
- Atomic temp-file-and-rename writes for the config file. Corrupted config triggers a backup-and-replace, then exits demanding re-auth.
- Per-tool failures are isolated — one broken tool doesn't take the server down.
- The `doctor` MCP tool aggregates live state (auth status, token expiry seconds, QBO reachability, last API call, last error, paths, version) so Claude can diagnose without external help.
- No automatic re-authentication when the refresh token is dead — the user must run `auth`. The server surfaces this as a clear actionable error rather than silently failing.

## Testing Decisions

### What makes a good test

We test **external behavior**, not implementation details. A good test asserts on the public interface of a module given inputs, not on which internal helpers got called. Tests should survive a refactor that doesn't change behavior.

We do **not mock the QBO API in integration tests**. The well-known anti-pattern: mocked tests pass while real calls fail because the mock encoded our assumptions, not Intuit's actual behavior. Integration tests hit the real QBO sandbox.

### Layers

- **Unit tests** (vitest) for pure or near-pure modules: `config-store` (atomicity matters), `pagination` (cursor encoding is tricky), `logger.readRecentLogs` (filter logic over JSON lines), `qbo-client` error mapping (pure function over fixture QBO error responses).
- **Integration tests** against the QBO sandbox: one happy-path test per MCP tool. Slow (~30s suite); run locally before publish; not in CI by default since the cost is real and the signal (Intuit changed their API) is rare.
- **No unit tests** for `auth-flow` (network + browser, exercised by the manual auth ceremony), `tool-registry` (covered transitively by integration tests), `doctor` (covered by the `npx qbo-mcp doctor` smoke check), `attachment-cache` (covered by an integration test).
- **No Claude-in-the-loop tests.** The MCP SDK exposes an in-memory transport that lets us call tool handlers directly. If Claude can't figure out how to use a tool, that's a tool-design problem found by using it, not a test problem.

### Smoke check

`npx qbo-mcp doctor` runs the same checks as the `doctor` MCP tool from a terminal. Used for "is my install working on this new device?" before pointing Claude at it, and as a CI smoke check once we publish a version.

### Prior art

The MCP TypeScript SDK ships with examples of in-memory transport tests; we follow that pattern. `node-quickbooks` has a fixtures directory we can reuse for `qbo-client` error-mapping unit tests.

## Out of Scope

- **Write tools of any kind.** Even though the OAuth scope grants write access, no tool implements it. Adding write capability is a deliberate future decision.
- **Multi-tenant operation.** Single user, single QBO realm per install.
- **Remote HTTP transport.** stdio only. Migration to HTTP is possible later by swapping the transport layer; the rest of the architecture is transport-agnostic.
- **Token sync across devices.** Each device authenticates independently. QBO rotates refresh tokens on every use, so syncing a token file via OneDrive/Dropbox would race and lock devices out.
- **Disk cache of QBO API responses.** No persistent caching of report or list results. Only `get_company_info` (in-memory, server-lifetime) and attachments (on-disk, LRU) are cached.
- **Auto re-authentication when refresh token dies.** The user must run `auth` again. We don't pretend to silently recover from this.
- **A `reset` MCP tool that wipes config.** Reset is a CLI-only command (`npx qbo-mcp reset --confirm`) — too dangerous to expose to Claude.
- **Claude-in-the-loop tests** that exercise actual model behavior end-to-end.
- **QBO entities outside the initial surface:** Budgets, Classes, Locations, Payroll, Time Tracking, Sales Tax. These can be added later via the same `tool-registry` patterns; explicitly deferred from v1 to keep scope finite.

## Further Notes

### Prerequisites on the operator

- Register an Intuit Developer app and capture `client_id` / `client_secret`. One app supports both sandbox and production via the `environment` flag in `intuit-oauth`.
- The redirect URI registered in the Intuit Developer app must include the local-callback URL the `auth` subcommand uses (default `http://localhost:8080/callback`, configurable to handle port conflicts).

### Known constraints

- QBO has no read-only OAuth scope. Read-only is a property of the MCP server, not the OAuth grant.
- QBO rate limit is 500 requests/minute per realm. Comfortably under for single-user ad-hoc use.
- QBO's `total_count` requires a separate `SELECT COUNT(*)` query before each list call. This adds a round-trip; we skip it when `cursor` is set (we're already paginating, no need to recount).
- Refresh tokens are rotated on every use. The persisted token must be replaced atomically.
- QBO sandbox data is too clean for meaningful anomaly-detection iteration. Sandbox is for plumbing verification; production is where anomaly-detection tools get real signal.

### Repo and package

- Repo: https://github.com/serj17/qbo-mcp
- npm package: `qbo-mcp` (confirmed available)

### Phasing

A single-milestone v1 ships the full ~21-tool surface. The grilling explored a 3-milestone phasing (thin slice -> read-only core -> full surface) but the operator opted to build everything at once given the small scope.
