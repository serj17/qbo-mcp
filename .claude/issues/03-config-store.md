## Parent

#1

## What to build

The `config-store` deep module that owns persistence of OAuth tokens and (optionally) Intuit app credentials at the OS-appropriate path resolved via `env-paths`. Writes are atomic (temp-file-and-rename) so a crash mid-write never leaves a corrupted file. On read, if the file is corrupted the module backs it up as `tokens.json.bak.<timestamp>` and surfaces a clear error so the caller can demand re-auth.

Public interface: `getConfig()`, `saveTokens(tokens)`, `clearConfig()`. App credentials are read from env vars first (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`), then from the config file. The module hides the precedence rule from callers.

## Acceptance criteria

- [x] `env-paths` resolves config dir to `%APPDATA%\qbo-mcp\` on Windows, `~/Library/Application Support/qbo-mcp/` on macOS, `~/.config/qbo-mcp/` on Linux
- [x] `saveTokens` writes to a temp file in the same dir then renames; never leaves a partial `tokens.json`
- [x] `getConfig` returns env-var app creds when set, falling back to file values
- [x] Corrupted JSON triggers a backup-and-rename to `tokens.json.bak.<unix-timestamp>` and throws a typed error
- [x] `clearConfig` removes the tokens file (best-effort; never throws on ENOENT)
- [x] Unit tests cover: atomicity (simulated crash mid-write), corruption recovery, env-var precedence, missing file handling, missing app creds error shape

## Blocked by

None — can start immediately.
