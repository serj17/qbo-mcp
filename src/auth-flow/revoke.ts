import { type AppCredentials, type Tokens, clearConfig } from "../config-store/index.js";

const REVOKE_ENDPOINT = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export type FetchLike = typeof fetch;

export interface RunRevokeOptions {
  appCreds: AppCredentials;
  tokens: Tokens;
  keepConfig?: boolean;
  /** Test injection: replace global fetch. */
  fetchImpl?: FetchLike;
}

export type RevokeResult =
  | { ok: true; cleared: boolean }
  | { ok: false; code: "REVOKE_HTTP_ERROR" | "REVOKE_NETWORK_ERROR"; message: string; status?: number };

/**
 * Call Intuit's OAuth revoke endpoint to invalidate the stored refresh
 * token, then clear local tokens.json (unless keepConfig is true).
 *
 * Per Intuit's docs the revoke endpoint accepts either an access_token
 * or refresh_token in the JSON body; revoking the refresh token also
 * invalidates the associated access token, so we send the refresh
 * token. Auth is HTTP Basic with `client_id:client_secret`.
 */
export async function runRevoke(options: RunRevokeOptions): Promise<RevokeResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const credential = Buffer.from(
    `${options.appCreds.client_id}:${options.appCreds.client_secret}`,
  ).toString("base64");

  let response: Response;
  try {
    response = await fetchImpl(REVOKE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credential}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: options.tokens.refresh_token }),
    });
  } catch (err) {
    return {
      ok: false,
      code: "REVOKE_NETWORK_ERROR",
      message: `Could not reach Intuit's revoke endpoint: ${(err as Error).message}`,
    };
  }

  if (!response.ok) {
    const bodyText = await safeReadText(response);
    return {
      ok: false,
      code: "REVOKE_HTTP_ERROR",
      message:
        `Intuit's revoke endpoint returned ${response.status}` +
        (bodyText ? `: ${bodyText.slice(0, 500)}` : ""),
      status: response.status,
    };
  }

  if (!options.keepConfig) {
    clearConfig();
  }
  return { ok: true, cleared: !options.keepConfig };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export interface RevokeArgs {
  keepConfig: boolean;
  helpRequested: boolean;
}

/**
 * Parse the flags following `qbo-mcp revoke`. Mirrors the parseAuthArgs
 * shape so tests can import without dragging in the bin entry's main().
 */
export function parseRevokeArgs(args: string[]): RevokeArgs {
  let keepConfig = false;
  let helpRequested = false;
  for (const arg of args) {
    if (arg === "--keep-config") {
      keepConfig = true;
    } else if (arg === "--help" || arg === "-h") {
      helpRequested = true;
    } else {
      throw new Error(`Unknown revoke flag: ${arg}. Run \`qbo-mcp revoke --help\`.`);
    }
  }
  return { keepConfig, helpRequested };
}

export const REVOKE_HELP_TEXT =
  "Usage: qbo-mcp revoke [options]\n" +
  "\n" +
  "Revoke the stored OAuth refresh token at Intuit and clear local tokens.json.\n" +
  "Use this when you suspect a token leak, are retiring a device, or want to\n" +
  "rotate credentials proactively. After revoking, run `qbo-mcp auth` to\n" +
  "re-authorize.\n" +
  "\n" +
  "Options:\n" +
  "  --keep-config   Revoke upstream at Intuit but leave tokens.json on disk\n" +
  "                  (the local file becomes useless — both the access and\n" +
  "                  refresh tokens are dead)\n" +
  "  -h, --help      Show this help\n";
