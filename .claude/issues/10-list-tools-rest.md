## Parent

#1

## What to build

The remaining five list tools: `list_customers`, `list_vendors`, `list_bills`, `list_accounts`, `list_transactions`. All of these reuse the `pagination` + `tool-registry` machinery proven in #8. Each one is essentially a Zod filter schema + a `qbo-client` query call.

Each tool gets a sandbox integration test (one happy path).

Filter shapes (per tool):

- `list_customers`: `{ active?, name_contains?, email_contains?, balance_gt?, balance_lt? }` + pagination
- `list_vendors`: `{ active?, name_contains?, balance_gt? }` + pagination
- `list_bills`: `{ status?, date_range?, vendor_id?, due_before?, due_after?, min_amount?, max_amount? }` + pagination
- `list_accounts`: `{ active?, account_type?, account_subtype?, name_contains? }` + pagination
- `list_transactions`: `{ date_range, account_ids?, txn_types?, min_amount?, max_amount? }` + pagination — uses QBO `TransactionList` report under the hood

## Acceptance criteria

- [ ] Each tool registered via `tool-registry.defineTool({ isList: true, ... })`
- [ ] Each Zod schema documented with descriptions on every field (Claude reads these)
- [ ] All five tools return the standard `{ items, page_info }` shape
- [ ] All five tools support `count_only`, `cursor`, `fetch_all`, `limit`
- [ ] One sandbox integration test per tool, asserting non-empty `items` from the canned sandbox data
- [ ] No `node-quickbooks` quirks leak through: each tool's response items are plain JSON entities, not library wrapper objects

## Blocked by

- Blocked by #8
