## Parent

#21

## Why

Per the gap report on #21: modern Advanced custom field values
(CCQ classification fields on Projects: Nature du projet, Rôle, Contrat,
CCQ value) are not exposed via the REST API. The user's concrete
near-term need is splitting revenue by these dimensions for an insurance
renewal — a task that cannot wait on Intuit's Platinum Partner
enrollment for the GraphQL endpoint (#23).

QBO Advanced lets the user export a CSV/XLSX of projects with their
custom field columns from the UI ("Custom fields" → "Export"). A simple
ingest tool that reads such an export and joins it to QBO entity IDs
covers the actual use case today, independent of API politics.

## What to build

A new MCP tool: `read_project_export({ path: string })`.

1. Reads a CSV or XLSX file from a user-supplied path on the local
   filesystem.
2. Parses it into `{ project_name: string, custom_fields: Record<string, string> }`
   per row.
3. Best-effort joins each row to a QBO Customer (sub-customer with
   `Job=true`) by `DisplayName` exact match. Returns the QBO `Id` where
   matched, `null` where unmatched.
4. Returns the joined data as the tool result so Claude can answer
   "which projects have CCQ value X" or "what's revenue split by Nature
   du projet" by combining this with `list_invoices` filtered on the
   matched Customer Ids.

### Stretch (split if it grows)

- A `get_project_custom_fields({ id })` convenience that pulls a single
  row from the cached parsed export by Customer Id.
- Auto-refresh: re-read the CSV if its mtime changed since last call.

## Schema sketch

```ts
{
  path: z.string().describe("Absolute path to the QBO Advanced project export (CSV or XLSX)."),
  match_strategy: z.enum(["exact", "prefix"]).default("exact").describe(
    "How to match export rows to QBO Customers. exact = DisplayName equality; prefix = export project name is a prefix of DisplayName (use when QBO appends extra info)."
  ),
}
```

## Acceptance criteria

- [ ] `read_project_export` tool registered via `tool-registry.defineTool({ ... })`
- [ ] Schema documents the export source (QBO UI → Custom fields → Export) and accepted formats
- [ ] CSV parser pulls headers + rows; XLSX support via a small dep (e.g. `xlsx` or `papaparse` for CSV-only v1)
- [ ] Best-effort join to QBO Customers, returning `match_status: "matched" | "unmatched"` per row
- [ ] Unit test for the parser using a fixture CSV (no QBO call needed)
- [ ] Sandbox integration test only if cheap; this tool is mostly local-disk work
- [ ] README mentions how to produce the export from QBO Advanced UI

## Blocked by

- Blocked by #21 (gap report providing context)

## Out of scope

- Writing back to QBO: this tool is read-only like the rest of qbo-mcp.
- Inferring custom field definitions from the CSV headers (would
  duplicate #23's GraphQL-based path; let definitions live there).
- Watching the file for changes; manual re-read on each tool call is fine
  for v1.
