## Parent

#1

## What to build

The `auth-flow` deep module plus the `auth` CLI subcommand. Drives the full OAuth ceremony: spawns a local HTTP listener on port 8080 (configurable), opens the user's browser to Intuit's auth URL, captures the redirected code, exchanges it for access + refresh tokens via `intuit-oauth`, persists them via `config-store`. Also supports a `--manual` fallback that prints the auth URL and prompts the user to paste back the redirect URL.

CLI surface added to the existing bin entry point:

```
npx -y qbo-mcp auth                          # interactive browser flow
npx -y qbo-mcp auth --manual                 # paste-the-URL fallback
npx -y qbo-mcp auth --env sandbox            # default
npx -y qbo-mcp auth --env production         # production
npx -y qbo-mcp auth --port 8081              # override callback port
```

Stores `realm_id`, `environment`, tokens, and timestamps in `config-store`.

## Acceptance criteria

- [ ] `npx -y . auth --env sandbox` opens the system browser to the correct Intuit auth URL
- [ ] After consenting in Intuit's UI, the local server captures the code, exchanges it, and writes tokens via `config-store`
- [ ] `--manual` prints the auth URL, accepts a pasted callback URL on stdin, extracts the code, completes the exchange
- [ ] OAuth `state` param is generated, validated on callback, mismatches reject the request
- [ ] `--port` flag works for users with port 8080 already in use
- [ ] Errors during exchange (e.g., expired code, bad client_secret) print actionable messages to stderr, exit code 1
- [ ] After success, the CLI prints the realm_id and environment, exits cleanly
- [ ] Re-running `auth` overwrites prior tokens (no orphaned files)
- [ ] No unit tests required (network + browser; covered by manual run before merging)

## Blocked by

- Blocked by #3
- Blocked by #5
