import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const maxIterations = Number(process.argv[2] ?? "1");

await run({
  agent: claudeCode("claude-opus-4-6"),
  sandbox: docker({
    imageName: "qbo-mcp-sandcastle:local",
    claudeAuth: true,
  }),
  promptFile: ".sandcastle/prompt.md",
  maxIterations,
  logging: { type: "stdout" },
});
