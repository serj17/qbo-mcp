import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getLogger, getLoggerPaths, readRecentLogs } from "./logger/index.js";

const server = new McpServer({
  name: "qbo-mcp",
  version: "0.1.0",
});

server.tool("ping", "Returns pong — used to verify the MCP server is reachable.", {}, async () => {
  return {
    content: [{ type: "text", text: "pong" }],
  };
});

server.tool(
  "get_recent_logs",
  "Read the most recent qbo-mcp log entries (newest first). Use this when a previous tool call failed and you need to see the structured QBO error, request body, or stack trace to diagnose. Each entry is JSON with time, level, optional tool name, msg, and any structured fields the call attached.",
  {
    lines: z.number().int().positive().max(1000).default(50).describe("How many log lines to return, newest first. Defaults to 50, max 1000."),
    level: z.enum(["debug", "info", "warn", "error"]).optional().describe("Filter to entries at this exact level."),
    tool: z.string().optional().describe("Filter to entries emitted by a specific tool name (e.g. 'list_invoices')."),
  },
  async ({ lines, level, tool }) => {
    const entries = readRecentLogs({ lines, level, tool });
    return {
      content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
    };
  },
);

async function main() {
  const logger = getLogger();
  const paths = getLoggerPaths();
  process.stderr.write(`qbo-mcp starting; logs at ${paths.logFile}\n`);
  logger.info({ event: "startup", log_file: paths.logFile }, "qbo-mcp starting");

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
