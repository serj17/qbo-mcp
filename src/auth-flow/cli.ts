import { type Environment } from "../config-store/index.js";

export interface AuthArgs {
  environment: Environment;
  manual: boolean;
  port: number;
  /** Set when the user passed --help; the caller should print and exit cleanly. */
  helpRequested?: boolean;
}

/**
 * Parse the flags following `qbo-mcp auth`. Throws on unknown flags or
 * malformed values; returns AuthArgs with `helpRequested: true` when the
 * user asked for help (caller prints help and exits 0).
 *
 * Accepts both `--flag value` and `--flag=value` forms for parity with
 * common CLI conventions.
 */
export function parseAuthArgs(args: string[]): AuthArgs {
  let environment: Environment = "sandbox";
  let manual = false;
  let port = 8080;
  let helpRequested = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--manual") {
      manual = true;
    } else if (arg === "--env" || arg === "-e") {
      environment = parseEnvValue(args[++i]);
    } else if (arg.startsWith("--env=")) {
      environment = parseEnvValue(arg.slice("--env=".length));
    } else if (arg === "--port" || arg === "-p") {
      port = parsePortValue(args[++i]);
    } else if (arg.startsWith("--port=")) {
      port = parsePortValue(arg.slice("--port=".length));
    } else if (arg === "--help" || arg === "-h") {
      helpRequested = true;
    } else {
      throw new Error(`Unknown auth flag: ${arg}. Run \`qbo-mcp auth --help\`.`);
    }
  }

  return { environment, manual, port, helpRequested };
}

function parseEnvValue(v: string | undefined): Environment {
  if (v === "sandbox" || v === "production") return v;
  throw new Error(`--env must be 'sandbox' or 'production', got: ${v ?? "<missing>"}`);
}

function parsePortValue(v: string | undefined): number {
  const n = Number.parseInt(v ?? "", 10);
  if (Number.isNaN(n) || n < 1 || n > 65535) {
    throw new Error(`--port must be 1-65535, got: ${v ?? "<missing>"}`);
  }
  return n;
}

export const AUTH_HELP_TEXT =
  "Usage: qbo-mcp auth [options]\n" +
  "\n" +
  "Authorize qbo-mcp against your QuickBooks Online company. Tokens are\n" +
  "saved to your OS-appropriate config dir and re-used by the MCP server.\n" +
  "\n" +
  "Options:\n" +
  "  --env <sandbox|production>  Which environment to authorize (default: sandbox)\n" +
  "  --manual                    Print the auth URL and accept the redirect URL pasted\n" +
  "                              back via stdin (use when localhost callback is blocked)\n" +
  "  --port <port>               Override the local callback port (default: 8080).\n" +
  "                              Add the matching redirect URI in your Intuit app config.\n" +
  "  -h, --help                  Show this help\n" +
  "\n" +
  "Required env vars:\n" +
  "  QBO_CLIENT_ID, QBO_CLIENT_SECRET\n" +
  "Optional env vars:\n" +
  "  QBO_MCP_CONFIG_DIR  Override the default config/log directory\n";
