## Parent

#1

## What to build

The two core financial report tools: `get_profit_and_loss` and `get_balance_sheet`. Both call QBO's Reports API endpoints (not the entity query API) and return the structured report data.

Schemas:

- `get_profit_and_loss({ start_date: ISO, end_date: ISO, accounting_method?: 'Cash' | 'Accrual', summarize_by?: 'Month' | 'Quarter' | 'Year' | 'Total' })`
- `get_balance_sheet({ as_of_date: ISO, accounting_method?: 'Cash' | 'Accrual' })`

Reports come back from QBO with a deeply nested header/columns/rows shape. Pass it through to Claude as-is — Claude is good at interpreting tabular structures. Don't try to flatten or "simplify"; that's a value-judgment call we'd get wrong.

## Acceptance criteria

- [ ] Both tools registered via `tool-registry.defineTool({ ... })`
- [ ] Zod schemas document accepted date formats and the meaning of `accounting_method` and `summarize_by`
- [ ] Default `accounting_method` is `Accrual` (matches QBO UI default)
- [ ] Tools return the QBO Report JSON unmodified
- [ ] One sandbox integration test per tool, asserting a non-empty `Rows` block in the response

## Blocked by

- Blocked by #8
