## Parent

#1

## Why

QBO Online Advanced lets users attach typed custom fields (List, Text, Number, Date) to Customers, Projects, Vendors, etc. via "Champs personnalisés" in the UI. These are distinct from the three legacy `CustomField` slots on sales transactions and use a separate API surface ("Custom Field Definitions v2", sometimes called modern/app-defined custom fields).

Today, none of our tools expose them:
- `list_customers` / `get_customer` / `qbo_query SELECT * FROM Customer` return zero info about them
- `SELECT * FROM CustomFieldDefinition` returns an empty `QueryResponse`

Concrete blocker: a real user has CCQ classification fields (Nature du projet, Rôle, Contrat, CCQ value) on every project. Insurance renewal needs revenue split by these dimensions — without API access, the only path is manual export of ~hundreds of projects, which is exactly the toil this MCP server exists to eliminate.

## What to build

Two new read-only tools:

1. `list_custom_field_definitions` — returns the company's modern custom field definitions (id, name, target entity types, data type, list options if List-typed). No filters needed for v1.

2. `get_entity_custom_fields` — given `{ entity_type: "Customer" | "Project" | "Vendor" | "Invoice" | ..., id: string }`, returns the modern custom field values set on that entity. Returns the raw QBO response with definition IDs resolved to definition names where cheap to do so (cache definitions for the server lifetime, like `get_company_info`).

Stretch (separate issue if it grows): include modern custom field values inline in `get_customer` / `list_customers` responses behind an opt-in flag, so callers don't need a second round-trip per entity.

## API surface (research notes)

Intuit's modern custom fields use a different endpoint family than the legacy `CustomField` array. Expected shape:

- Definitions: `GET /v3/company/{realmId}/customfielddefinition` (or via QBQL `SELECT * FROM CustomFieldDefinition` — currently empty for our test realm, needs verification: is the API gated by app permissions/scope, requires a different entity name, or is data really absent?)
- Values: typically returned on entities under a `customField` extension, but may require a query parameter like `?include=allextensions` or a sidecar endpoint. Verify against Intuit docs and against a sandbox company that has Advanced custom fields configured.

First implementation step is reproducing the call manually with curl against the production realm of the user reporting this (after auth) to confirm exact endpoint and response shape, then wrapping in the qbo-client.

## Acceptance criteria

- [ ] Both tools registered via `tool-registry.defineTool({ ... })` (not list mode)
- [ ] Definitions cached for the server process lifetime (same pattern as `get_company_info`)
- [ ] Schemas document that these are QBO Advanced–only and will return empty for non-Advanced subscriptions
- [ ] Sandbox integration test for `list_custom_field_definitions` against a sandbox company with at least one modern custom field configured
- [ ] Sandbox integration test for `get_entity_custom_fields` retrieving a known value on a known Customer
- [ ] If Intuit's API does not expose modern custom field values via the standard entity endpoints (hard requirement to verify before committing to the design), close this issue with a comment documenting the gap and open a follow-up for an alternative path (e.g., QBO bulk export ingest)

## Blocked by

- Blocked by #16 (qbo_query) for ad-hoc verification
- Blocked by #11 (detail fetchers) only if the stretch goal is included
