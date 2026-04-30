import OAuthClient from "intuit-oauth";
import type { Logger } from "pino";
import {
  type AppCredentials,
  type Tokens,
  saveTokens,
} from "../config-store/index.js";
import { mapToQboError, type QboError, type RawErrorInput, type Result } from "./errors.js";

export { type QboError, type QboErrorCode, type Result } from "./errors.js";

/** QBO REST API minor-version pin. Bump deliberately when the response shape we depend on changes. */
const QBO_MINOR_VERSION = "75";

const SANDBOX_BASE_URL = "https://sandbox-quickbooks.api.intuit.com";
const PRODUCTION_BASE_URL = "https://quickbooks.api.intuit.com";

export type FetchLike = typeof fetch;

export interface QboClientDeps {
  appCreds: AppCredentials;
  initialTokens: Tokens;
  logger: Logger;
  /** Test injection: replace global fetch. */
  fetchImpl?: FetchLike;
  /** Test injection: replace the OAuthClient that drives token refresh. */
  oauthClient?: OAuthLikeClient;
  /** Clock source for expiry math. Defaults to Date.now. */
  now?: () => number;
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

function buildOAuthClient(appCreds: AppCredentials, environment: Tokens["environment"]): OAuthLikeClient {
  return new OAuthClient({
    clientId: appCreds.client_id,
    clientSecret: appCreds.client_secret,
    environment,
    redirectUri: "http://localhost:8080/callback",
  }) as unknown as OAuthLikeClient;
}

function baseUrlFor(environment: Tokens["environment"]): string {
  return environment === "sandbox" ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
}

/**
 * QBO HTTP client. Owns:
 *
 *   - the active access + refresh tokens (mutated on refresh, persisted via
 *     config-store)
 *   - one fetch invocation per call, with Authorization: Bearer header
 *   - silent refresh on 401, retry-once policy
 *   - error normalization via mapToQboError
 *   - structured logging of every request (path, query length, duration,
 *     status, outcome)
 *
 * Public methods return Result<T, QboError>. They never throw for QBO-side
 * problems — only for programmer errors.
 *
 * The HTTP transport is intentionally hand-rolled (fetch + Bearer + JSON
 * parse) rather than going through node-quickbooks. QBO is a plain REST
 * API; library wrappers don't insulate from anything that's actually
 * changing, and they got in the way of the raw QBQL passthrough we need.
 */
export class QboClient {
  private currentTokens: Tokens;
  private oauth: OAuthLikeClient;
  private readonly logger: Logger;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly baseUrl: string;

  constructor(deps: QboClientDeps) {
    this.currentTokens = deps.initialTokens;
    this.logger = deps.logger;
    this.now = deps.now ?? Date.now;
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.oauth = deps.oauthClient ?? buildOAuthClient(deps.appCreds, deps.initialTokens.environment);
    this.baseUrl = baseUrlFor(deps.initialTokens.environment);
  }

  /**
   * Run a raw QBQL query. Hits /v3/company/{realm}/query. Returns the full
   * QueryResponse wrapper verbatim so callers can extract entity arrays
   * (`response.QueryResponse.Invoice`) or counts
   * (`response.QueryResponse.totalCount`).
   */
  async query<T = unknown>(qbql: string): Promise<Result<T, QboError>> {
    const path = `/query?query=${encodeURIComponent(qbql)}`;
    return this.invoke<T>("query", { qbql }, { isQueryCall: true }, "GET", path);
  }

  /**
   * Fetch the QBO CompanyInfo entity. Used by get_company_info and the
   * doctor for orientation (legal name, fiscal year start, currency).
   */
  async getCompanyInfo<T = unknown>(): Promise<Result<T, QboError>> {
    const realmId = this.currentTokens.realm_id;
    return this.invoke<T>("getCompanyInfo", { realmId }, {}, "GET", `/companyinfo/${realmId}`);
  }

  /**
   * Fetch a QBO report by name with the given query params. Used for reports
   * like TransactionList that don't have a QBQL equivalent.
   */
  async report<T = unknown>(reportName: string, params: Record<string, string>): Promise<Result<T, QboError>> {
    const qs = new URLSearchParams(params).toString();
    const path = `/reports/${reportName}${qs ? `?${qs}` : ""}`;
    return this.invoke<T>("report", { reportName }, {}, "GET", path);
  }

  /** Snapshot of the active tokens — exposed for the doctor tool. */
  getTokens(): Tokens {
    return { ...this.currentTokens };
  }

  /**
   * Issue an authenticated request, with the silent-refresh-and-retry-once
   * policy on 401. Path should be relative to /v3/company/{realm} and
   * include any pre-built query string. minorversion is appended here so
   * callers don't repeat themselves.
   */
  private async invoke<T>(
    op: string,
    logFields: Record<string, unknown>,
    errorContext: Pick<RawErrorInput, "isQueryCall">,
    method: "GET" | "POST",
    relativePath: string,
  ): Promise<Result<T, QboError>> {
    const start = this.now();
    this.logger.info({ op, ...logFields, event: "qbo_request_start" }, `qbo ${op} request`);

    let attempt = 0;
    while (true) {
      attempt++;
      const url = this.buildUrl(relativePath);
      const raw = await this.attempt<T>(method, url);
      if (raw.ok) {
        this.logger.info(
          { op, ...logFields, attempt, duration_ms: this.now() - start, event: "qbo_request_ok" },
          `qbo ${op} ok`,
        );
        return { ok: true, value: raw.value };
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
   * Build the canonical URL: base + /v3/company/{realm} + relativePath, with
   * minorversion appended to whatever query string is already present.
   */
  private buildUrl(relativePath: string): string {
    const path = `/v3/company/${this.currentTokens.realm_id}${relativePath}`;
    const sep = path.includes("?") ? "&" : "?";
    return `${this.baseUrl}${path}${sep}minorversion=${QBO_MINOR_VERSION}`;
  }

  /**
   * One HTTP attempt. Resolves to either { ok: true, value } on a successful
   * 2xx with parseable JSON, or { ok: false, error: RawErrorInput } on
   * anything else. Never throws — fetch's promise rejection (network error)
   * is caught and converted.
   */
  private async attempt<T>(
    method: "GET" | "POST",
    url: string,
  ): Promise<{ ok: true; value: T } | { ok: false; error: RawErrorInput }> {
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.currentTokens.access_token}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const body = await this.readBodyTolerant(response);
        const retryAfterRaw = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : undefined;
        return {
          ok: false,
          error: {
            status: response.status,
            body,
            retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
          },
        };
      }

      const value = (await response.json()) as T;
      return { ok: true, value };
    } catch (err) {
      const e = err as Error & { code?: string };
      return {
        ok: false,
        error: { networkError: true, cause: { message: e.message, code: e.code } },
      };
    }
  }

  /**
   * Read a non-2xx body. Tries JSON first (most QBO errors), falls back to
   * text. Returning null is OK — the mapper handles missing bodies.
   */
  private async readBodyTolerant(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        return await response.json();
      }
      const text = await response.text();
      return text || null;
    } catch {
      return null;
    }
  }

  /**
   * Refresh tokens via intuit-oauth. Persists the rotated refresh token via
   * config-store BEFORE returning success so a crash between refresh and
   * retry doesn't lose the new credential — Intuit rotates the refresh
   * token on every use.
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
 * Bring axios-shaped errors and similar legacy shapes into the structural
 * RawErrorInput the mapper consumes. Kept for backward compat with the
 * error mapper tests; not used by the fetch path internally.
 */
export function normalizeRawError(err: unknown): RawErrorInput {
  if (!err) {
    return { networkError: false, cause: { message: "Unknown empty error" } };
  }

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
