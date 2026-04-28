## Parent

#1

## What to build

The `qbo_query` escape hatch tool. Takes a raw QuickBooks Query Language string and runs it against the QBO query endpoint, returning the raw response. This is the "last resort" tool for cases the curated tools don't cover.

Schema: `{ query: string }`. The Zod description should explain QBQL is QBO-flavored SQL with documented restrictions (no joins beyond a few specific cases, `STARTPOSITION` / `MAXRESULTS` for pagination, `SELECT *` is allowed) and link to Intuit's reference page.

Bad syntax returns `INVALID_QUERY` with the QBO fault message verbatim so Claude can fix the query and retry.

## Acceptance criteria

- [ ] Tool registered via `tool-registry.defineTool({ ... })` (not list mode — pagination is the caller's responsibility on raw queries)
- [ ] Returns the raw QBO response under a top-level key (e.g., `{ QueryResponse: ... }`) so Claude sees the same shape Intuit's docs describe
- [ ] Bad QBQL produces a structured `INVALID_QUERY` error with QBO's message text intact
- [ ] One sandbox integration test for happy path: `SELECT * FROM Customer MAXRESULTS 5` returns 5 customers
- [ ] One sandbox integration test for error path: malformed query returns `INVALID_QUERY` with the right `_meta.code`

## Blocked by

- Blocked by #7
