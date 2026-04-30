## Parent

#1

## What to build

The `get_company_info` MCP tool, plus an in-memory cache that keeps the result for the lifetime of the server process. Used by Claude at the start of a conversation to orient itself (legal name, fiscal year start month, currency, country) and used internally by other tools that need fiscal-year boundaries (e.g., for "this fiscal year" date math).

This is the only QBO call we cache, and only because company-level metadata virtually never changes during a session.

## Acceptance criteria

- [x] `get_company_info` registered as an MCP tool with no input schema (or empty schema)
- [x] Returns `{ company_name, legal_name, country, fiscal_year_start_month, supported_languages?, default_currency?, ... }` from QBO's CompanyInfo
- [x] First call hits QBO; subsequent calls within the same server process return the cached result
- [x] Cache is process-local (in-memory only), invalidated on server restart
- [x] One sandbox integration test asserts the call returns a valid CompanyInfo shape

## Blocked by

- Blocked by #8
