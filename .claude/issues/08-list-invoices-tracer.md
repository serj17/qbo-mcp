## Parent

#1

## What to build

The first end-to-end vertical slice through every layer: `pagination` module + `tool-registry` module + the `list_invoices` MCP tool, with a sandbox integration test that proves the whole thing works.

`pagination` owns the cursor encode/decode, the count query, and the `fetch_all` coordinator (auto-paginate up to 5000 records, error above). Its public output shape is fixed: `{ items, page_info: { total_count, returned_count, has_more, next_cursor } }`. Every list tool in the codebase uses it.

`tool-registry` is the wrapper that turns `(name, zodSchema, handler)` into a registered MCP tool with automatic logging, error mapping (`QboError` → `isError: true` + `_meta.code` + remediation text), and (when the tool is declared as a list tool) the pagination wrapper.

`list_invoices` is the proof — it uses both modules, takes typed filters (`status`, `date_range`, `customer_id`, `min_amount`, `max_amount`) plus pagination params (`limit`, `cursor`, `fetch_all`, `count_only`), calls `qbo-client.queryInvoices(...)`, returns the standard list shape.

## Acceptance criteria

- [x] `pagination.paginate({ queryFn, params })` handles cursor encode/decode, `count_only`, and `fetch_all` with a 5000 hard cap
- [x] Cursor format is opaque to callers (Claude treats it as a string); internally it's the QBO `STARTPOSITION`
- [x] `count_only: true` skips the data query, returns just `{ total_count: N }`
- [x] When `cursor` is set, the count query is skipped (we're already paginating)
- [x] `tool-registry.defineTool({ name, schema, handler, isList? })` registers a tool with automatic try/catch → `QboError` → MCP error shape, logs entry/exit, applies pagination if `isList`
- [x] Error tool results carry `isError: true`, a `text` content block with remediation, and `_meta.code`
- [x] `list_invoices` accepts the documented filters via Zod schema and returns the standard `{ items, page_info }` shape
- [x] One sandbox integration test: with the QBO sandbox company connected, `list_invoices({ limit: 5 })` returns 5 items + correct `page_info`
- [x] Unit tests on `pagination`: cursor encode/decode, fetch_all hard cap, count_only short-circuit

## Blocked by

- Blocked by #4
- Blocked by #7
