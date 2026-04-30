import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AUTH_HELP_TEXT, parseAuthArgs } from "./auth-flow/cli.js";
import { AuthFlowError, runAuthFlow } from "./auth-flow/index.js";
import { getConfig } from "./config-store/index.js";
import { formatReportForCli, runDoctor, startupSelfCheck } from "./doctor/index.js";
import { getLogger, getLoggerPaths, readRecentLogs } from "./logger/index.js";
import { QboClient } from "./qbo-client/index.js";
import { SyncFolderDetectedError, getSafeBaseDir } from "./safe-paths/index.js";
import { defineTool } from "./tool-registry/index.js";
import { getBillTool } from "./tools/get_bill.js";
import { getCompanyInfoTool } from "./tools/get_company_info.js";
import { getCustomerTool } from "./tools/get_customer.js";
import { getInvoiceTool } from "./tools/get_invoice.js";
import { getVendorTool } from "./tools/get_vendor.js";
import { listAccountsTool } from "./tools/list_accounts.js";
import { listBillsTool } from "./tools/list_bills.js";
import { listCustomersTool } from "./tools/list_customers.js";
import { listInvoicesTool } from "./tools/list_invoices.js";
import { listTransactionsTool } from "./tools/list_transactions.js";
import { listVendorsTool } from "./tools/list_vendors.js";

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

async function runDoctorCommand(): Promise<void> {
  try {
    getSafeBaseDir();
  } catch (err) {
    if (err instanceof SyncFolderDetectedError) {
      process.stderr.write(`qbo-mcp: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const logger = getLogger();
  const report = await runDoctor({ logger });
  process.stdout.write(formatReportForCli(report));

  const allPassed = report.checks.every((c) => c.passed);
  process.exit(allPassed ? 0 : 1);
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

  const logger = getLogger();
  const paths = getLoggerPaths();
  process.stderr.write(`qbo-mcp starting; logs at ${paths.logFile}\n`);
  logger.info({ event: "startup", log_file: paths.logFile }, "qbo-mcp starting");

  // --- Startup self-check ---
  const config = getConfig();
  if (!config.tokens || !config.appCreds) {
    const env = config.tokens?.environment ?? "sandbox";
    process.stderr.write(
      `qbo-mcp: not authorized — no tokens found. Run \`npx qbo-mcp auth --env=${env}\` to authorize.\n`,
    );
    logger.error({ event: "startup_check_failed", reason: "missing_tokens" }, "startup check failed: no tokens");
    process.exit(1);
  }

  const now = Date.now();
  if (now >= config.tokens.refresh_token_expires_at) {
    process.stderr.write(
      `qbo-mcp: refresh token has expired. Run \`npx qbo-mcp auth --env=${config.tokens.environment}\` to re-authorize.\n`,
    );
    logger.error({ event: "startup_check_failed", reason: "refresh_token_expired" }, "startup check failed: refresh token expired");
    process.exit(1);
  }

  const qbo = new QboClient({
    appCreds: config.appCreds,
    initialTokens: config.tokens,
    logger,
  });

  // QBO reachability — warn but don't exit
  const companyResult = await qbo.getCompanyInfo();
  if (!companyResult.ok) {
    process.stderr.write(
      `qbo-mcp: warning — QBO unreachable (${companyResult.error.code}). Server starting anyway; tools may fail.\n`,
    );
    logger.warn(
      { event: "startup_qbo_unreachable", code: companyResult.error.code, msg: companyResult.error.message },
      "startup: QBO unreachable, continuing",
    );
  } else {
    logger.info({ event: "startup_qbo_ok" }, "startup: QBO reachable");
  }

  // --- Build server ---
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

  server.tool(
    "doctor",
    "Returns a structured health report: auth status, token expiry, QBO reachability, last API call, last error, config and log paths, version. Use this to diagnose problems without asking the user to inspect anything.",
    {},
    async () => {
      const report = await runDoctor({ logger, qboClient: qbo });
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    },
  );

  // Wire QBO tools
  defineTool(server, { qbo, logger }, listInvoicesTool);
  defineTool(server, { qbo, logger }, listCustomersTool);
  defineTool(server, { qbo, logger }, listVendorsTool);
  defineTool(server, { qbo, logger }, listBillsTool);
  defineTool(server, { qbo, logger }, listAccountsTool);
  defineTool(server, { qbo, logger }, listTransactionsTool);
  defineTool(server, { qbo, logger }, getCompanyInfoTool);
  defineTool(server, { qbo, logger }, getInvoiceTool);
  defineTool(server, { qbo, logger }, getCustomerTool);
  defineTool(server, { qbo, logger }, getVendorTool);
  defineTool(server, { qbo, logger }, getBillTool);
  logger.info(
    { realm_id: config.tokens.realm_id, environment: config.tokens.environment, event: "qbo_tools_registered" },
    "qbo tools registered",
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const TOP_LEVEL_HELP =
  "Usage: qbo-mcp [command] [options]\n\n" +
  "Commands:\n" +
  "  (no command)  Run the MCP server on stdio (default; what Claude Code launches)\n" +
  "  auth          Authorize against QuickBooks Online (run before first server use)\n" +
  "  doctor        Run health checks and print a diagnostic report\n" +
  "\n" +
  "Run `qbo-mcp auth --help` for auth-specific options.\n";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === undefined) {
    await runMcpServer();
    return;
  }

  if (cmd === "auth") {
    await runAuthCommand(argv.slice(1));
    return;
  }

  if (cmd === "doctor") {
    await runDoctorCommand();
    return;
  }

  if (cmd === "--help" || cmd === "-h") {
    process.stderr.write(TOP_LEVEL_HELP);
    process.exit(0);
  }

  process.stderr.write(
    `qbo-mcp: unknown command or flag: ${cmd}\n\n${TOP_LEVEL_HELP}`,
  );
  process.exit(1);
}

void main();
