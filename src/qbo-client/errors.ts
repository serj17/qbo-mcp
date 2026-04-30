export type QboErrorCode =
  | "AUTH_REFRESH_FAILED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_QUERY"
  | "QBO_SERVER_ERROR"
  | "NETWORK_ERROR";

export interface QboError {
  code: QboErrorCode;
  message: string;
  retryable: boolean;
  /** HTTP status code from QBO if the call reached a server */
  qbo_status?: number;
  /** Raw QBO Fault payload, preserved verbatim for debugging */
  qbo_fault?: unknown;
  /** Seconds until retry when rate-limited */
  retry_after_seconds?: number;
}

export type Result<T, E = QboError> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Input shape the mapper accepts. Keeping the mapper purely structural means
 * we can drive it from real axios errors, fixture JSON, or hand-rolled inputs
 * in tests without coupling to any HTTP client.
 */
export interface RawErrorInput {
  /** HTTP status code if the response reached us. */
  status?: number;
  /** `Retry-After` header value parsed to seconds. */
  retryAfterSeconds?: number;
  /** Parsed JSON response body — typically a QBO Fault wrapper. */
  body?: unknown;
  /** The original thrown error, for `cause.message` fallback. */
  cause?: { message?: string; code?: string };
  /** Set when the call was a query() — promotes INVALID_INPUT to INVALID_QUERY. */
  isQueryCall?: boolean;
  /** Set when fetch/axios threw before getting a response (DNS, ECONNREFUSED, etc.). */
  networkError?: boolean;
  /**
   * Set when this maps the *second* failure after a refresh attempt — promotes
   * any 401 to AUTH_REFRESH_FAILED. Without it, a 401 at the qbo-client layer
   * means "trigger refresh", not "give up".
   */
  postRefresh?: boolean;
}

/**
 * Map a heterogeneous error input (axios error, network failure, raw body)
 * into the canonical QboError shape consumed by every tool. Pure: no I/O,
 * no logging, no token state.
 */
export function mapToQboError(input: RawErrorInput): QboError {
  if (input.networkError) {
    return {
      code: "NETWORK_ERROR",
      message: input.cause?.message ?? "Network error reaching QuickBooks API",
      retryable: true,
    };
  }

  const status = input.status;
  const fault = extractFault(input.body);

  if (status === 401) {
    if (input.postRefresh) {
      return {
        code: "AUTH_REFRESH_FAILED",
        message:
          "QuickBooks rejected the access token even after refresh. The refresh token may be expired or revoked. Run `npx qbo-mcp auth` to re-authorize.",
        retryable: false,
        qbo_status: 401,
        qbo_fault: input.body,
      };
    }
    return {
      code: "AUTH_REFRESH_FAILED",
      message: "Access token expired or invalid; refresh attempt did not recover.",
      retryable: false,
      qbo_status: 401,
      qbo_fault: input.body,
    };
  }

  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: `Rate limited by QuickBooks. ${input.retryAfterSeconds ? `Retry after ${input.retryAfterSeconds}s.` : "Wait and retry."}`,
      retryable: true,
      qbo_status: 429,
      retry_after_seconds: input.retryAfterSeconds,
      qbo_fault: input.body,
    };
  }

  if (typeof status === "number" && status >= 500) {
    return {
      code: "QBO_SERVER_ERROR",
      message: `QuickBooks API returned ${status}. ${faultMessage(fault) ?? "No fault details."}`,
      retryable: true,
      qbo_status: status,
      qbo_fault: input.body,
    };
  }

  if (status === 404 || faultHasCode(fault, "610")) {
    return {
      code: "NOT_FOUND",
      message: faultMessage(fault) ?? "Entity not found.",
      retryable: false,
      qbo_status: status,
      qbo_fault: input.body,
    };
  }

  if (status === 400 || faultHasType(fault, ["ValidationFault", "BusinessValidationFault"])) {
    const code: QboErrorCode = input.isQueryCall ? "INVALID_QUERY" : "INVALID_INPUT";
    return {
      code,
      message: faultMessage(fault) ?? "Invalid request rejected by QuickBooks.",
      retryable: false,
      qbo_status: status,
      qbo_fault: input.body,
    };
  }

  return {
    code: "QBO_SERVER_ERROR",
    message: faultMessage(fault) ?? input.cause?.message ?? "Unknown QuickBooks error.",
    retryable: false,
    qbo_status: status,
    qbo_fault: input.body,
  };
}

interface QboFault {
  type?: string;
  Error?: Array<{ Message?: string; Detail?: string; code?: string; element?: string }>;
}

function extractFault(body: unknown): QboFault | undefined {
  if (!body || typeof body !== "object") return undefined;
  const fault = (body as { Fault?: unknown }).Fault;
  if (!fault || typeof fault !== "object") return undefined;
  return fault as QboFault;
}

function faultMessage(fault: QboFault | undefined): string | undefined {
  if (!fault?.Error?.length) return undefined;
  const first = fault.Error[0]!;
  return first.Detail ?? first.Message;
}

function faultHasCode(fault: QboFault | undefined, code: string): boolean {
  return Boolean(fault?.Error?.some((e) => e.code === code));
}

function faultHasType(fault: QboFault | undefined, types: string[]): boolean {
  return Boolean(fault?.type && types.includes(fault.type));
}
