## Parent

#1

## What to build

A startup guard that refuses to load `tokens.json` if its resolved path lies inside a known cloud-sync folder (OneDrive, Dropbox, iCloud Drive, Google Drive). Closes the most realistic accidental-leak vector: tokens silently replicating to a third-party cloud because the user's `%APPDATA%` or `~/Library/Application Support/` was redirected.

The check is path-based: walk up from the resolved config dir and check each ancestor against a list of known sync-folder names and known sync-folder marker files (e.g., `.dropbox`, `.OneDriveIgnore`, `~/Library/Mobile Documents/`).

If a sync folder is detected, the server (and CLI) exits cleanly with code 1 and a message that names the offending sync folder and points the user at the `QBO_MCP_CONFIG_DIR` env var to override the location. Override exists so users who genuinely want to live with the sync risk can opt in explicitly.

This check belongs either in `config-store` (alongside path resolution) or in the `doctor` startup self-check (#9). Implementer's call — just do not duplicate the logic.

## Acceptance criteria

- [x] Detects OneDrive on Windows by checking ancestor dir names and the `.OneDriveIgnore` / `desktop.ini` marker convention
- [x] Detects Dropbox by checking for a `.dropbox` marker in any ancestor dir
- [x] Detects iCloud by checking for paths under `~/Library/Mobile Documents/`
- [x] Detects Google Drive (Drive for Desktop) by checking for a `desktop.ini` with the `CLSID` Google Drive uses, or by ancestor-name match (`Google Drive`, `GoogleDrive`)
- [x] On detection, the server / CLI exits with code 1 and a stderr message naming the detected provider and the override env var
- [x] `QBO_MCP_CONFIG_DIR` env var, when set, replaces the `env-paths`-derived location and **bypasses** the sync-folder check (treated as "user opted in")
- [x] Unit tests cover each detector against fixture path trees, plus the override-bypass case

## Blocked by

None — can start immediately. Logic can land in `config-store` (extending #3) or in `doctor` (folded into #9). Either way, no upstream blockers.
