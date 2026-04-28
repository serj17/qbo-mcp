## Parent

#1

## What to build

The four detail fetcher tools that return a single full nested entity given its ID: `get_invoice`, `get_customer`, `get_vendor`, `get_bill`. These are used when Claude needs the complete record (line items, addresses, custom fields, all nested associations) rather than the summarized view returned by the list tools.

Each tool takes `{ id: string }` (the QBO entity ID) and returns the full QBO entity object. NOT_FOUND comes back as the standard structured error.

## Acceptance criteria

- [ ] Each tool registered via `tool-registry.defineTool({ ... })` (not list mode)
- [ ] Each Zod schema documents that `id` is the QBO entity ID, not a custom number like `DocNumber`
- [ ] Each tool returns the raw QBO entity JSON (no wrapping)
- [ ] Missing IDs return the standard `NOT_FOUND` MCP error result
- [ ] One sandbox integration test per tool: fetch a known-good ID from sandbox data, assert the entity shape

## Blocked by

- Blocked by #8
