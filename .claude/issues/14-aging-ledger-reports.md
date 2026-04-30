## Parent

#1

## What to build

The aging and ledger report tools: `get_ar_aging_summary`, `get_ap_aging_summary`, and `get_general_ledger`. All three call QBO's Reports API.

Schemas:

- `get_ar_aging_summary({ as_of_date?: ISO, customer_id?: string })` — defaults to today
- `get_ap_aging_summary({ as_of_date?: ISO, vendor_id?: string })` — defaults to today
- `get_general_ledger({ start_date: ISO, end_date: ISO, account_ids?: string[], summarize_by?: 'Month' | 'Total' })`

Like the financial reports, return the QBO Report JSON unmodified.

## Acceptance criteria

- [x] Three tools registered via `tool-registry.defineTool({ ... })`
- [x] Zod schemas document accepted date formats and what `summarize_by` does on the GL
- [x] Aging tools default `as_of_date` to today (server local date) when omitted
- [x] Tools return the QBO Report JSON unmodified
- [x] One sandbox integration test per tool

## Blocked by

- Blocked by #8
