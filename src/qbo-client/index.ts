import OAuthClient from "intuit-oauth";
import QuickBooks from "node-quickbooks";
import type { Logger } from "pino";
import {
  type AppCredentials,
  type Tokens,
  saveTokens,
} from "../config-store/index.js";
import { mapToQboError, type QboError, type RawErrorInput, type Result } from "./errors.js";

export { type QboError, type QboErrorCode, type Result } from "./errors.js";

export interface QboClientDeps {
  appCreds: AppCredentials;
  initialTokens: Tokens;
  logger: Logger;
  /** Test injection: replace the OAuthClient that drives token refresh. */
  oauthClient?: OAuthLikeClient;
  /** Test injection: replace the QuickBooks instance factory. */
  quickbooksFactory?: (params: QuickBooksFactoryParams) => QuickBooksLike;
  /** Clock source for expiry math. Defaults to Date.now. */
  now?: () => number;
}

export interface QuickBooksFactoryParams {
  appCreds: AppCredentials;
  tokens: Tokens;
}

export interface QuickBooksLike {
  query: (qbql: string, callback: (err: unknown, data: unknown) => void) => void;
  getCompanyInfo: (id: string, callback: (err: unknown, data: unknown) => void) => void;
  /** Mutated when we refresh — node-quickbooks reads this prop on each request. */
  token: string;
}

export interface OAuthLikeClient {
  token: { setToken: (params: Record<string, unknown>) => void };
  refresh: () => Promise<{
    token?: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      x_refresh_token_expires_in?: number;
      createdAt?: number;
    };
  }>;
}

/**
 * Build the canonical OAuthClient used for refresh. Production code path —
 * tests inject their own via QboClientDeps.oauthClient.
 */
function buildOAuthClient(appCreds: AppCredentials, environment: Tokens["environment"]): OAuthLikeClient {
  return new OAuthClient({
    clientId: appCreds.client_id,
    clientSecret: appCreds.client_secret,
    environment,
    redirectUri: "http://localhost:8080/callback",
  }) as unknown as OAuthLikeClient;
}

function buildQuickBooksInstance(params: QuickBooksFactoryParams): QuickBooksLike {
  const { appCreds, tokens } = params;
  const useSandbox = tokens.environment === "sandbox";
  // node-quickbooks's positional constructor — see its README. tokenSecret is
  // unused under OAuth 2.0 (we pass false); minorversion 75 matches the
  // library default for current accounting endpoints.
  const qb = new (QuickBooks as unknown as new (...args: unknown[]) => QuickBooksLike)(
    appCreds.client_id,
    appCreds.client_secret,
    tokens.access_token,
    false,
    tokens.realm_id,
    useSandbox,
    false,
    75,
    "2.0",
    tokens.refresh_token,
  );
  return qb;
}

/**
 * Thin wrapper over node-quickbooks. Owns:
 *   - the live QuickBooks instance (re-bound to refreshed tokens in place)
 *   - the OAuthClient used for refresh
 *   - the silent-refresh-on-401-then-retry-once policy
 *   - error normalization to QboError
 *   - structured logging of every call (request shape, duration, status)
 *
 * Public methods return Result<T, QboError>. They never throw for QBO-side
 * problems — only for programmer errors (e.g. impossible tokens shape).
 */
export class QboClient {
  private qb: QuickBooksLike;
  private oauth: OAuthLikeClient;
  private currentTokens: Tokens;
  private readonly logger: Logger;
  private readonly appCreds: AppCredentials;
  private readonly now: () => number;
  private readonly factory: (params: QuickBooksFactoryParams) => QuickBooksLike;

  constructor(deps: QboClientDeps) {
    this.appCreds = deps.appCreds;
    this.currentTokens = deps.initialTokens;
    this.logger = deps.logger;
    this.now = deps.now ?? Date.now;
    this.factory = deps.quickbooksFactory ?? buildQuickBooksInstance;
    this.oauth = deps.oauthClient ?? buildOAuthClient(deps.appCreds, deps.initialTokens.environment);
    this.qb = this.factory({ appCreds: deps.appCreds, tokens: deps.initialTokens });
  }

  /**
   * Run a raw QBQL query. Used by every list_* tool through the pagination
   * wrapper, and exposed directly via the qbo_query escape-hatch tool.
   */
  async query<T = unknown>(qbql: string): Promise<Result<T, QboError>> {
    return this.invoke("query", { qbql }, { isQueryCall: true }, (qb, cb) => qb.query(qbql, cb));
  }

  /**
   * Fetch the QBO CompanyInfo entity (legal name, fiscal year start, currency).
   * Used by get_company_info plus internally by tools that need fiscal-year math.
   */
  async getCompanyInfo<T = unknown>(): Promise<Result<T, QboError>> {
    const realmId = this.currentTokens.realm_id;
    return this.invoke("getCompanyInfo", { realmId }, {}, (qb, cb) => qb.getCompanyInfo(realmId, cb));
  }

  /** Snapshot of the active tokens — exposed for the doctor tool. */
  getTokens(): Tokens {
    return { ...this.currentTokens };
  }

  /**
   * Core invoke: log the call, attempt it, on a 401-shaped error refresh
   * tokens and retry exactly once. After the retry, a 401 means
   * AUTH_REFRESH_FAILED — the user must re-auth.
   */
  private async invoke<T>(
    op: string,
    logFields: Record<string, unknown>,
    errorContext: Pick<RawErrorInput, "isQueryCall">,
    call: (qb: QuickBooksLike, cb: (err: unknown, data: unknown) => void) => void,
  ): Promise<Result<T, QboError>> {
    const start = this.now();
    this.logger.info({ op, ...logFields, event: "qbo_request_start" }, `qbo ${op} request`);

    let attempt = 0;
    while (true) {
      attempt++;
      const raw = await this.attempt(call);
      if (raw.ok) {
        this.logger.info(
          { op, ...logFields, attempt, duration_ms: this.now() - start, event: "qbo_request_ok" },
          `qbo ${op} ok`,
        );
        return { ok: true, value: raw.value as T };
      }

      const status = raw.error.status;
      const isAuth = status === 401;
      if (isAuth && attempt === 1) {
        this.logger.warn({ op, status, event: "qbo_auth_refresh" }, "qbo got 401, refreshing");
        const refreshed = await this.refresh();
        if (!refreshed.ok) {
          this.logger.error(
            { op, code: refreshed.error.code, msg: refreshed.error.message, event: "qbo_refresh_failed" },
            "qbo refresh failed",
          );
          return refreshed;
        }
        continue;
      }

      const qboError = mapToQboError({
        ...raw.error,
        ...errorContext,
        postRefresh: isAuth && attempt > 1,
      });
      this.logger.error(
        {
          op,
          ...logFields,
          attempt,
          duration_ms: this.now() - start,
          code: qboError.code,
          status: qboError.qbo_status,
          msg: qboError.message,
          event: "qbo_request_error",
        },
        `qbo ${op} error`,
      );
      return { ok: false, error: qboError };
    }
  }

  /**
   * Single attempt against the QuickBooks instance. Promisifies the
   * callback API and normalizes axios errors / thrown errors into
   * RawErrorInput so the upstream invoke loop can decide whether to
   * refresh-and-retry or report.
   */
  private async attempt(
    call: (qb: QuickBooksLike, cb: (err: unknown, data: unknown) => void) => void,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: RawErrorInput }> {
    return new Promise((resolve) => {
      try {
        call(this.qb, (err, data) => {
          if (!err) {
            resolve({ ok: true, value: data });
            return;
          }
          resolve({ ok: false, error: normalizeRawError(err) });
        });
      } catch (err) {
        resolve({ ok: false, error: normalizeRawError(err) });
      }
    });
  }

  /**
   * Refresh tokens via intuit-oauth. Persists the rotated refresh token
   * BEFORE returning success so a crash between refresh and retry doesn't
   * lose the new credential. Mutates the internal QuickBooks instance's
   * `token` field in place — node-quickbooks reads it on each request.
   */
  async refresh(): Promise<Result<void, QboError>> {
    try {
      this.oauth.token.setToken({
        access_token: this.currentTokens.access_token,
        refresh_token: this.currentTokens.refresh_token,
        token_type: "bearer",
        realmId: this.currentTokens.realm_id,
      });
      const response = await this.oauth.refresh();
      const t = response?.token ?? {};
      if (!t.access_token || !t.refresh_token) {
        return {
          ok: false,
          error: {
            code: "AUTH_REFRESH_FAILED",
            message: "Refresh response from Intuit was missing access_token or refresh_token.",
            retryable: false,
          },
        };
      }
      const base = typeof t.createdAt === "number" ? t.createdAt : this.now();
      const accessLifetimeMs = (t.expires_in ?? 3600) * 1000;
      const refreshLifetimeMs = (t.x_refresh_token_expires_in ?? 8_640_000) * 1000;
      const next: Tokens = {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        realm_id: this.currentTokens.realm_id,
        environment: this.currentTokens.environment,
        access_token_expires_at: base + accessLifetimeMs,
        refresh_token_expires_at: base + refreshLifetimeMs,
      };
      saveTokens(next);
      this.currentTokens = next;
      this.qb.token = next.access_token;
      return { ok: true, value: undefined };
    } catch (err) {
      const wrapped = err as { error?: string; error_description?: string; message?: string };
      return {
        ok: false,
        error: {
          code: "AUTH_REFRESH_FAILED",
          message: `Token refresh failed: ${wrapped.error_description ?? wrapped.error ?? wrapped.message ?? "unknown error"}. Run \`npx qbo-mcp auth\` to re-authorize.`,
          retryable: false,
        },
      };
    }
  }
}

/**
 * Bring the wide universe of error shapes (axios, plain Error, string,
 * object with a `.fault` field) into the structural RawErrorInput the mapper
 * understands. Defensive about every field — nothing throws regardless of
 * what node-quickbooks hands us.
 */
export function normalizeRawError(err: unknown): RawErrorInput {
  if (!err) {
    return { networkError: false, cause: { message: "Unknown empty error" } };
  }

  // axios-shaped error from node-quickbooks: { response: { status, data, headers }, code, message }
  if (typeof err === "object") {
    const e = err as {
      response?: { status?: number; data?: unknown; headers?: Record<string, string> };
      code?: string;
      message?: string;
      fault?: unknown;
    };
    if (e.response) {
      const retryAfterRaw = e.response.headers?.["retry-after"];
      const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : undefined;
      return {
        status: e.response.status,
        body: e.response.data ?? e.fault,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        cause: { message: e.message, code: e.code },
      };
    }
    // Network errors from axios surface here without a response.
    if (e.code && /^E[A-Z]+$/.test(e.code)) {
      return { networkError: true, cause: { message: e.message, code: e.code } };
    }
    if (typeof e.message === "string") {
      return { cause: { message: e.message, code: e.code } };
    }
  }

  if (typeof err === "string") return { cause: { message: err } };

  return { cause: { message: String(err) } };
}
