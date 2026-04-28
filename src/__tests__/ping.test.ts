import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "qbo-mcp",
    version: "0.1.0",
  });

  server.tool("ping", "Returns pong", {}, async () => {
    return {
      content: [{ type: "text", text: "pong" }],
    };
  });

  return server;
}

describe("ping tool", () => {
  it("returns pong", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "ping", arguments: {} });

    expect(result.content).toEqual([{ type: "text", text: "pong" }]);

    await client.close();
    await server.close();
  });
});
