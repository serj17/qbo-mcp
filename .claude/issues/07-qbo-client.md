## Parent

#1

## What to build

The `qbo-client` deep module: a thin layer over `node-quickbooks` and `intuit-oauth` that adds the cross-cutting concerns every QBO call needs.

Responsibilities:

- Construct the `node-quickbooks` instance from the persisted config + currently-valid access token.
- Intercept HTTP 401 responses, refresh the access token via `intuit-oauth.refresh()`, persist the rotated refresh token via `config-store`, retry the original call exactly once.
- Normalize every error (HTTP, QBO API errors, network errors) into a single `QboError` shape with `{ code, message, retryable, qbo_status?, qbo_fault? }` where `code` is one of `AUTH_REFRESH_FAILED | RATE_LIMITED | NOT_FOUND | INVALID_INPUT | QBO_SERVER_ERROR | INVALID_QUERY | NETWORK_ERROR`.
- Log every request (method, path, params) and response (status, duration, excerpt) through `logger`.
- Methods are `Result<T, QboError>` flavored (no throwing for QBO errors; only programmer errors throw).

This is the deepest module in the codebase — every QBO API quirk is contained here. Everything above it (tools, tool-registry, doctor) is QBO-agnostic.

## Acceptance criteria

- [ ] Single retry on 401 with refresh; second 401 returns `AUTH_REFRESH_FAILED`
- [ ] Rotated refresh token is persisted before the retry (so a crash between refresh and retry doesn't lose the new refresh token)
- [ ] HTTP 429 maps to `RATE_LIMITED` with `retry_after_seconds` parsed from the `Retry-After` header
- [ ] HTTP 404 / QBO `ObjectNotFound` fault maps to `NOT_FOUND`
- [ ] QBO `ValidationFault` / `BusinessValidationFault` maps to `INVALID_INPUT` with the QBO message preserved
- [ ] HTTP 5xx maps to `QBO_SERVER_ERROR` with `retryable: true`
- [ ] Network/socket errors map to `NETWORK_ERROR` with `retryable: true`
- [ ] Bad QBQL syntax maps to `INVALID_QUERY` with the QBO error verbatim
- [ ] Each call logs a request + response line at `info`, errors at `error` with full QBO fault payload
- [ ] Unit tests on the error mapper alone, using fixture QBO error responses (no network)

## Blocked by

- Blocked by #6
