## Parent

#1

## What to build

A `revoke` CLI subcommand that calls Intuit's OAuth revoke endpoint to invalidate the currently-stored refresh token, then clears the local `tokens.json`. Used when:

- You suspect a token leak.
- You're retiring a device and want the credential gone from Intuit's side, not just from disk.
- You want to rotate proactively (e.g., after a backup-sync mishap).

CLI surface:

```
npx -y qbo-mcp revoke                  # revokes the refresh token, clears local config
npx -y qbo-mcp revoke --keep-config    # revokes upstream but leaves the (now-dead) tokens.json on disk
```

After a successful revoke, the next QBO API call would fail with `AUTH_REFRESH_FAILED` — exactly the same code path the server already handles for natural expiry, so no special-case logic in `qbo-client` needed.

## Acceptance criteria

- [x] `npx -y qbo-mcp revoke` POSTs to Intuit's revoke endpoint (`https://developer.api.intuit.com/v2/oauth2/tokens/revoke`) with the stored refresh token
- [x] On success, the local `tokens.json` is removed via `config-store.clearConfig()` (unless `--keep-config` is passed)
- [x] On failure (network error, already-revoked, etc.), the CLI prints the error to stderr and exits with code 1; the local file is not touched
- [x] A "no tokens to revoke" case (file missing) exits cleanly with a friendly message and code 0
- [x] Unit-tested where the logic is non-trivial (the HTTP call itself can be exercised manually); the path-clearing logic is already covered by `config-store` tests

## Blocked by

- Blocked by #6
