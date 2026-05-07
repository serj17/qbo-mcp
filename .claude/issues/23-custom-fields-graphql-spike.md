## Parent

#21

## Why

Per the gap report on #21: the QBO REST API does not return modern Advanced
custom field values on standard entity GETs (with or without
`?include=enhancedAllCustomFields`). The data is only available via the
GraphQL endpoint `appFoundationsCustomFieldDefinitions` on
`https://qb.api.intuit.com/graphql`, which requires:

1. A new OAuth scope: `app-foundations.custom-field-definitions.read`.
2. Per Intuit's December 2025 announcement, **Platinum Partner status** for
   the Intuit Developer app.

Before we commit to a full implementation, spike whether (2) actually
gates non-Platinum apps from *reading* (the announcement language was
ambiguous about read-only access), and whether (1) can be added to the
existing auth flow without breaking sandbox auth.

## What to build

A timeboxed spike — **read-only, no production tools shipped yet**.

1. Update `auth-flow` to additionally request the
   `app-foundations.custom-field-definitions.read` scope alongside
   `Accounting`. Verify the Intuit consent screen accepts the combined
   scope set in sandbox.
2. Once consented in sandbox, send the GraphQL POST manually:

   ```
   POST https://qb.api.intuit.com/graphql
   Authorization: Bearer <access_token>
   Content-Type: application/json

   { "query": "{ appFoundationsCustomFieldDefinitions { id name type legacyIdV2 } }" }
   ```

3. Document in this issue's Outcome section: HTTP status, response body
   (including any error code Intuit returns for non-Platinum apps), and
   whether the response shape matches what their docs describe.
4. If the spike succeeds (we get definitions back without Platinum
   Partner enrollment), open a follow-up that promotes the spike into a
   real `list_custom_field_definitions` + `get_entity_custom_fields` tool
   pair, including the inherited definition-name mapping.
5. If the spike fails with a hard "Platinum Partner required" error,
   close this issue with that finding and rely on #24 (CSV ingest) as
   the path forward.

## Acceptance criteria

- [ ] Auth flow extended to request the new scope; sandbox consent works
- [ ] Production consent re-verified (the user re-runs `npx qbo-mcp auth --env=production` once)
- [ ] One GraphQL POST attempted against production; response captured
- [ ] Outcome section in this issue file written with status, body, decision
- [ ] If success: follow-up issue opened to ship the tools
- [ ] If failure: this issue closed and #24 prioritized

## Blocked by

- Blocked by #21 (gap report providing context for this spike)
