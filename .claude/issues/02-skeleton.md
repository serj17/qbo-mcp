## Parent

#1

## What to build

Bootstrap the `qbo-mcp` repo as a TypeScript Node project with the `@modelcontextprotocol/sdk` wired up to expose a single `ping` tool that returns `"pong"`. This is the first tracer bullet: it proves the MCP wire protocol works end-to-end inside Claude Code before anything QBO-specific gets touched.

The package should already be configured to publish as `qbo-mcp` to npm and be invocable via `npx -y .` from a local checkout. `vitest` is set up but no QBO tests yet.

## Acceptance criteria

- [ ] `package.json` declares `"name": "qbo-mcp"`, `"type": "module"`, `"bin": { "qbo-mcp": "./dist/index.js" }`, Node `>=20` engines field
- [ ] TypeScript build configured (e.g. `tsup` or `tsc`); `npm run build` produces `dist/index.js` with a shebang line
- [ ] `vitest` configured; `npm test` runs an empty/sample test green
- [ ] `npm run start` and `node dist/index.js` boot the MCP server on stdio
- [ ] A single `ping` MCP tool is registered; calling it returns `"pong"`
- [ ] Claude Code can be configured with `npx -y .` (or absolute path to `dist/index.js`) and call the `ping` tool successfully
- [ ] `.gitignore` covers `node_modules`, `dist`, `.env`, OS junk
- [ ] MIT `LICENSE` file in repo root

## Blocked by

None — can start immediately.
