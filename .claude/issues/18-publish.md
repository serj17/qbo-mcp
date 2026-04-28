## Parent

#1

## What to build

**HITL** — publish v0.1.0 to npm and verify the install works on a fresh device.

This is the moment the package becomes installable via `npx -y qbo-mcp` instead of `npx -y .` from a local checkout. Required for the multi-device workflow that motivated the project.

## Acceptance criteria

- [ ] `package.json` version set to `0.1.0`; `description`, `keywords`, `repository`, `homepage`, `bugs`, `license`, `author` fields populated
- [ ] `README.md` covers: install (`npx -y qbo-mcp auth` then point Claude at `npx -y qbo-mcp`), prerequisites (Intuit Developer app), env vars, troubleshooting via `npx qbo-mcp doctor` and `get_recent_logs` MCP tool
- [ ] `npm publish --access public` succeeds (or `--access restricted` if scoped and intended private)
- [ ] On a second device with no prior install: `npx -y qbo-mcp auth --env sandbox` succeeds, `npx -y qbo-mcp doctor` reports green
- [ ] A v0.1.0 git tag is pushed and a corresponding GitHub Release is created with brief notes
- [ ] A "tested on" entry added to README listing OS/Node versions verified

## Blocked by

- Blocked by #17
