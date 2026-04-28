import { interactive, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// One-shot interactive session for `claude /login`.
//
// This launches the sandcastle docker sandbox with claudeAuth enabled and
// drops you into the Claude Code TUI inside the container. Type `/login`
// to complete the OAuth flow with your Claude Pro/Max account, then `/exit`
// (or Ctrl+C) to leave. Tokens land in the named volume `sandcastle-claude-auth`
// and are reused by every subsequent `npm run sandcastle` invocation.
//
// Run with: npm run sandcastle:login

await interactive({
  agent: claudeCode("claude-opus-4-6"),
  sandbox: docker({
    imageName: "qbo-mcp-sandcastle:local",
    claudeAuth: true,
  }),
});
