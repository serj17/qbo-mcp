import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "qbo-mcp",
  version: "0.1.0",
});

server.tool("ping", "Returns pong — used to verify the MCP server is reachable.", {}, async () => {
  return {
    content: [{ type: "text", text: "pong" }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
