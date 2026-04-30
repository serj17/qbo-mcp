import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline";
import OAuthClient from "intuit-oauth";
import open from "open";
import { type Environment, type Tokens, saveTokens } from "../config-store/index.js";

export interface AppCredentialsInput {
  client_id: string;
  client_secret: string;
}

export interface RunAuthFlowOptions {
  appCreds: AppCredentialsInput;
  environment: Environment;
  manual?: boolean;
  port?: number;
  /** Override the default redirect host. Defaults to "localhost". Used by tests. */
  callbackHost?: string;
  /** Test injection: if provided, replaces the default open() browser-launch. */
  openBrowser?: (url: string) => Promise<void> | void;
  /** Test injection: if provided, replaces the default stdin reader for --manual. */
  readPastedUrl?: () => Promise<string>;
  /** Test injection: source for the OAuth state param so tests can be deterministic. */
  generateState?: () => string;
  /** Test injection: clock source so expiry math is reproducible. */
  now?: () => number;
}

export interface AuthFlowResult {
  realm_id: string;
  environment: Environment;
}

const DEFAULT_PORT = 8080;
const DEFAULT_CALLBACK_PATH = "/callback";

/**
 * Production redirect URI. Intuit requires HTTPS + publicly resolvable URLs
 * for production OAuth apps and rejects http://localhost. This static page
 * (hosted on GitHub Pages) receives the redirect, displays the URL for the
 * user to copy, and the CLI's --manual flow extracts the code from the
 * pasted URL. No secrets ever touch this static page; the OAuth code is
 * short-lived and useless without the client_secret which stays local.
 *
 * Update both this constant AND the redirect URI registered in your
 * Intuit Developer app's Production OAuth settings if you change the
 * hosting location.
 */
const PRODUCTION_REDIRECT_URI = "https://serj17.github.io/qbo-mcp/callback.html";

export class AuthFlowError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthFlowError";
    this.code = code;
  }
}

/**
 * Build the redirect URI consistently across the URL we send to Intuit, the
 * port we bind locally, and the path the callback handler matches against.
 */
export function buildRedirectUri(host: string, port: number, path = DEFAULT_CALLBACK_PATH): string {
  return `http://${host}:${port}${path}`;
}

export function defaultGenerateState(): string {
  return randomBytes(16).toString("hex");
}

export interface ParsedCallback {
  ok: true;
  code: string;
  state: string;
  realmId: string;
}
export interface ParsedCallbackError {
  ok: false;
  error: string;
  errorDescription?: string;
}

/**
 * Parse a callback URL string (or query-only fragment) into the OAuth fields
 * we need. Both the full URL form and the bare path-with-query form are
 * accepted so the --manual flow tolerates whatever the user pastes back.
 */
export function parseCallbackUrl(input: string): ParsedCallback | ParsedCallbackError {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    // Maybe the user pasted just the path-with-query, e.g. "/callback?code=..."
    try {
      url = new URL(input, "http://localhost");
    } catch {
      return { ok: false, error: "invalid_url", errorDescription: `Could not parse: ${input}` };
    }
  }
  const params = url.searchParams;
  const error = params.get("error");
  if (error) {
    return {
      ok: false,
      error,
      errorDescription: params.get("error_description") ?? undefined,
    };
  }
  const code = params.get("code");
  const state = params.get("state");
  const realmId = params.get("realmId");
  if (!code || !state || !realmId) {
    return {
      ok: false,
      error: "missing_params",
      errorDescription: "Callback URL is missing one of: code, state, realmId",
    };
  }
  return { ok: true, code, state, realmId };
}

interface OAuthClientLike {
  authorizeUri(params: { scope: string | string[]; state?: string }): string;
  createToken(uri: string): Promise<{ token?: { access_token?: string; refresh_token?: string; expires_in?: number; x_refresh_token_expires_in?: number; realmId?: string; createdAt?: number } }>;
}

/**
 * Compute access/refresh expiry timestamps (epoch ms) from the OAuth response.
 * Falls back to the configured `now()` when createdAt is missing, and uses
 * conservative defaults if the lifetime fields are absent (better than NaN).
 */
function computeExpiries(
  tokenPart: { expires_in?: number; x_refresh_token_expires_in?: number; createdAt?: number },
  now: () => number,
): { access_token_expires_at: number; refresh_token_expires_at: number } {
  const base = typeof tokenPart.createdAt === "number" ? tokenPart.createdAt : now();
  const accessLifetime = (tokenPart.expires_in ?? 3600) * 1000;
  const refreshLifetime = (tokenPart.x_refresh_token_expires_in ?? 8_640_000) * 1000;
  return {
    access_token_expires_at: base + accessLifetime,
    refresh_token_expires_at: base + refreshLifetime,
  };
}

/**
 * Run the full OAuth ceremony end-to-end. Returns the realm + environment on
 * success. Throws AuthFlowError with a `code` that distinguishes user-facing
 * remediation paths (state mismatch vs. exchange failure vs. user cancel).
 */
export async function runAuthFlow(options: RunAuthFlowOptions): Promise<AuthFlowResult> {
  const port = options.port ?? DEFAULT_PORT;
  const callbackHost = options.callbackHost ?? "localhost";
  const isProd = options.environment === "production";

  // Intuit forbids http://localhost in production redirect URIs. We use a
  // static GitHub Pages page as the redirect target instead. Because that
  // page is remote, the local HTTP listener can't receive the callback —
  // we auto-flip to manual mode (user copies the redirected URL back into
  // the terminal). Sandbox keeps the localhost listener flow.
  const redirectUri = isProd ? PRODUCTION_REDIRECT_URI : buildRedirectUri(callbackHost, port);
  const useManual = options.manual || isProd;
  if (isProd && !options.manual) {
    process.stderr.write(
      "production environment uses an HTTPS callback URL; auto-switching to --manual mode.\n",
    );
  }

  const generateState = options.generateState ?? defaultGenerateState;
  const now = options.now ?? Date.now;
  const openBrowser = options.openBrowser ?? (async (url: string) => { await open(url); });

  const oauth = new OAuthClient({
    clientId: options.appCreds.client_id,
    clientSecret: options.appCreds.client_secret,
    environment: options.environment,
    redirectUri,
  }) as unknown as OAuthClientLike;

  const state = generateState();
  const authorizeUrl = oauth.authorizeUri({
    scope: (OAuthClient as unknown as { scopes: { Accounting: string } }).scopes.Accounting,
    state,
  });

  const callbackUrl = useManual
    ? await runManualFlow(authorizeUrl, options.readPastedUrl)
    : await runBrowserFlow({ authorizeUrl, port, callbackHost, openBrowser });

  const parsed = parseCallbackUrl(callbackUrl);
  if (!parsed.ok) {
    throw new AuthFlowError(
      "OAUTH_CALLBACK_ERROR",
      `OAuth callback returned an error: ${parsed.error}${parsed.errorDescription ? ` — ${parsed.errorDescription}` : ""}`,
    );
  }
  if (parsed.state !== state) {
    throw new AuthFlowError(
      "OAUTH_STATE_MISMATCH",
      "OAuth state mismatch. Refusing to proceed; this can indicate a CSRF attempt or a stale browser session.",
    );
  }

  let response;
  try {
    response = await oauth.createToken(callbackUrl);
  } catch (err) {
    const wrapped = err as { error?: string; error_description?: string; message?: string };
    const detail = wrapped.error_description ?? wrapped.error ?? wrapped.message ?? "unknown error";
    throw new AuthFlowError(
      "OAUTH_TOKEN_EXCHANGE_FAILED",
      `Failed to exchange authorization code for tokens: ${detail}. Common causes: client_secret mismatch, code expired (must be used within ~10 min), wrong environment flag.`,
    );
  }

  const tokenPart = response?.token ?? {};
  if (!tokenPart.access_token || !tokenPart.refresh_token || !tokenPart.realmId) {
    throw new AuthFlowError(
      "OAUTH_TOKEN_RESPONSE_MALFORMED",
      "Intuit returned a token response missing required fields (access_token, refresh_token, or realmId).",
    );
  }

  const expiries = computeExpiries(tokenPart, now);
  const tokens: Tokens = {
    access_token: tokenPart.access_token,
    refresh_token: tokenPart.refresh_token,
    realm_id: tokenPart.realmId,
    environment: options.environment,
    ...expiries,
  };
  saveTokens(tokens);

  return { realm_id: tokens.realm_id, environment: options.environment };
}

async function runBrowserFlow(args: {
  authorizeUrl: string;
  port: number;
  callbackHost: string;
  openBrowser: (url: string) => Promise<void> | void;
}): Promise<string> {
  const { authorizeUrl, port, callbackHost, openBrowser } = args;
  return new Promise<string>((resolve, reject) => {
    let server: Server | undefined;
    const cleanup = () => {
      if (server) server.close();
    };

    server = createServer((req, res) => {
      const url = req.url ?? "";
      if (!url.startsWith(DEFAULT_CALLBACK_PATH)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const fullUrl = `http://${callbackHost}:${port}${url}`;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        "<!doctype html><meta charset='utf-8'><title>qbo-mcp auth</title>" +
          "<body style='font-family:system-ui;padding:2rem'>" +
          "<h2>qbo-mcp authorization complete</h2>" +
          "<p>You can close this tab and return to your terminal.</p></body>",
      );
      cleanup();
      resolve(fullUrl);
    });

    server.on("error", (err) => {
      cleanup();
      const e = err as NodeJS.ErrnoException;
      if (e.code === "EADDRINUSE") {
        reject(
          new AuthFlowError(
            "PORT_IN_USE",
            `Port ${port} is already in use. Pass --port=<other-port> and add the matching redirect URI in your Intuit app config.`,
          ),
        );
        return;
      }
      reject(err);
    });

    server.listen(port, callbackHost, () => {
      void Promise.resolve(openBrowser(authorizeUrl)).catch((err) => {
        cleanup();
        reject(
          new AuthFlowError(
            "BROWSER_OPEN_FAILED",
            `Could not open the system browser. Re-run with --manual and paste the URL yourself: ${authorizeUrl} (underlying: ${(err as Error).message})`,
          ),
        );
      });
    });
  });
}

async function runManualFlow(
  authorizeUrl: string,
  reader?: () => Promise<string>,
): Promise<string> {
  process.stderr.write(
    "\nManual auth flow.\n\n" +
      "1. Open this URL in any browser:\n\n" +
      `${authorizeUrl}\n\n` +
      "2. After authorizing, you will be redirected to a localhost URL that will fail to load.\n" +
      "   Copy the FULL URL from your browser's address bar (it includes ?code=...&state=...&realmId=...).\n\n" +
      "3. Paste it here and press Enter:\n> ",
  );
  const input = reader ? await reader() : await readLineFromStdin();
  return input.trim();
}

function readLineFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.once("line", (line) => {
      rl.close();
      resolve(line);
    });
  });
}
