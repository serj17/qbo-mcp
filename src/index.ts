import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AUTH_HELP_TEXT, parseAuthArgs } from "./auth-flow/cli.js";
import { AuthFlowError, runAuthFlow } from "./auth-flow/index.js";
import { getLogger, getLoggerPaths, readRecentLogs } from "./logger/index.js";
import { SyncFolderDetectedError, getSafeBaseDir } from "./safe-paths/index.js";

async function runAuthCommand(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseAuthArgs(args);
  } catch (err) {
    process.stderr.write(`qbo-mcp: ${(err as Error).message}\n`);
    process.exit(1);
  }
  if (parsed.helpRequested) {
    process.stderr.write(AUTH_HELP_TEXT);
    process.exit(0);
  }

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    process.stderr.write(
      "qbo-mcp: QBO_CLIENT_ID and QBO_CLIENT_SECRET must be set (in your shell env or .env file). " +
        "Get them from https://developer.intuit.com -> your app -> Keys & OAuth.\n",
    );
    process.exit(1);
  }

  try {
    getSafeBaseDir();
  } catch (err) {
    if (err instanceof SyncFolderDetectedError) {
      process.stderr.write(`qbo-mcp: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  try {
    const result = await runAuthFlow({
      appCreds: { client_id: clientId, client_secret: clientSecret },
      environment: parsed.environment,
      manual: parsed.manual,
      port: parsed.port,
    });
    process.stderr.write(
      `\nqbo-mcp: authorized successfully.\n` +
        `  environment: ${result.environment}\n` +
        `  realm_id:    ${result.realm_id}\n`,
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof AuthFlowError) {
      process.stderr.write(`qbo-mcp [${err.code}]: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

async function runMcpServer(): Promise<void> {
  try {
    getSafeBaseDir();
  } catch (err) {
    if (err instanceof SyncFolderDetectedError) {
      process.stderr.write(`qbo-mcp: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const server = new McpServer({ name: "qbo-mcp", version: "0.1.0" });

  server.tool("ping", "Returns pong — used to verify the MCP server is reachable.", {}, async () => {
    return { content: [{ type: "text", text: "pong" }] };
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
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    },
  );

  const logger = getLogger();
  const paths = getLoggerPaths();
  process.stderr.write(`qbo-mcp starting; logs at ${paths.logFile}\n`);
  logger.info({ event: "startup", log_file: paths.logFile }, "qbo-mcp starting");

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === "auth") {
    await runAuthCommand(argv.slice(1));
    return;
  }

  if (cmd === "--help" || cmd === "-h") {
    process.stderr.write(
      "Usage: qbo-mcp [command] [options]\n\n" +
        "Commands:\n" +
        "  (no command)  Run the MCP server on stdio (default; what Claude Code launches)\n" +
        "  auth          Authorize against QuickBooks Online (run before first server use)\n" +
        "\n" +
        "Run `qbo-mcp auth --help` for auth-specific options.\n",
    );
    process.exit(0);
  }

  await runMcpServer();
}

void main();
