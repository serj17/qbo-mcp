## Parent

#1

## What to build

**HITL** — promote from sandbox-only to production-capable. With all tools implemented and tested against the sandbox, re-authenticate against the real QBO company file and run a smoke test of the core tools to catch any production-vs-sandbox differences (real-world entity shapes, custom fields, edge cases that don't appear in Intuit's canned sandbox data).

Document any prod-only quirks discovered in `CHANGELOG.md` or a `KNOWN-ISSUES.md` so they don't surprise future-you on a fresh device install.

## Acceptance criteria

- [x] `npx qbo-mcp auth --env production` completes successfully against the real QBO company
- [x] `npx qbo-mcp doctor` reports green against production
- [x] Manually run, in a Claude Code conversation against production: at least one report (P&L), at least one list tool with filters, one detail fetcher, one attachment fetch, one anomaly-style query (e.g., "find any vendors with similar names")
- [x] Any prod-only edge cases or surprises documented in repo (e.g., custom fields with unusual types, very long strings that truncate in logs, attachments behind extra auth) — landed in `KNOWN-ISSUES.md` via #22
- [x] Confirm read-only behavior: no QBO entities were created or modified during the smoke test

## Blocked by

- Blocked by #9
- Blocked by #10
- Blocked by #11
- Blocked by #12
- Blocked by #13
- Blocked by #14
- Blocked by #15
- Blocked by #16
