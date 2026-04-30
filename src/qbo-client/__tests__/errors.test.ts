import { describe, expect, it } from "vitest";
import { mapToQboError } from "../errors.js";
import { normalizeRawError } from "../index.js";

const validationFault = {
  Fault: {
    type: "ValidationFault",
    Error: [
      {
        Message: "QueryParseError",
        Detail: "QueryParserError: Encountered ' '<EOF>' '' at line 1, column 14.",
        code: "4000",
      },
    ],
  },
  time: "2026-04-30T00:00:00.000Z",
};

const objectNotFoundFault = {
  Fault: {
    type: "ValidationFault",
    Error: [
      {
        Message: "Object Not Found",
        Detail: "Object Not Found : Something you're trying to use has been made inactive.",
        code: "610",
      },
    ],
  },
};

const businessValidationFault = {
  Fault: {
    type: "BusinessValidationFault",
    Error: [
      {
        Message: "Customer name already exists",
        Detail: "Another customer or vendor is already using this name. Please use a different name.",
        code: "6240",
      },
    ],
  },
};

const authFault = {
  Fault: {
    type: "AuthenticationFault",
    Error: [{ Message: "Unauthorized", Detail: "Token expired", code: "3200" }],
  },
};

const systemFault = {
  Fault: {
    type: "SystemFault",
    Error: [{ Message: "Internal error", Detail: "Try again later", code: "10000" }],
  },
};

describe("mapToQboError", () => {
  describe("network errors", () => {
    it("maps network failures to NETWORK_ERROR with retryable=true", () => {
      const err = mapToQboError({ networkError: true, cause: { message: "ENOTFOUND quickbooks.api.intuit.com", code: "ENOTFOUND" } });
      expect(err).toMatchObject({
        code: "NETWORK_ERROR",
        retryable: true,
      });
      expect(err.message).toContain("ENOTFOUND");
    });

    it("falls back to a generic message when no cause is given", () => {
      const err = mapToQboError({ networkError: true });
      expect(err.code).toBe("NETWORK_ERROR");
      expect(err.message).toBeTruthy();
    });
  });

  describe("authentication errors", () => {
    it("a 401 *before* refresh is still typed AUTH_REFRESH_FAILED but signals refresh is required", () => {
      const err = mapToQboError({ status: 401, body: authFault });
      expect(err.code).toBe("AUTH_REFRESH_FAILED");
      expect(err.retryable).toBe(false);
      expect(err.qbo_status).toBe(401);
    });

    it("a 401 *after* refresh attempts uses the post-refresh remediation message", () => {
      const err = mapToQboError({ status: 401, body: authFault, postRefresh: true });
      expect(err.code).toBe("AUTH_REFRESH_FAILED");
      expect(err.message).toContain("npx qbo-mcp auth");
    });
  });

  describe("rate limiting", () => {
    it("maps 429 to RATE_LIMITED with retryable=true and parses retry_after_seconds", () => {
      const err = mapToQboError({ status: 429, retryAfterSeconds: 30 });
      expect(err).toMatchObject({
        code: "RATE_LIMITED",
        retryable: true,
        qbo_status: 429,
        retry_after_seconds: 30,
      });
      expect(err.message).toContain("30s");
    });

    it("handles missing Retry-After header gracefully", () => {
      const err = mapToQboError({ status: 429 });
      expect(err.code).toBe("RATE_LIMITED");
      expect(err.retry_after_seconds).toBeUndefined();
    });
  });

  describe("server errors", () => {
    it("maps 5xx to QBO_SERVER_ERROR with retryable=true", () => {
      const err = mapToQboError({ status: 503, body: systemFault });
      expect(err).toMatchObject({
        code: "QBO_SERVER_ERROR",
        retryable: true,
        qbo_status: 503,
      });
    });

    it("includes the QBO fault detail in the message", () => {
      const err = mapToQboError({ status: 502, body: systemFault });
      expect(err.message).toContain("Try again later");
    });

    it("maps unknown statuses to QBO_SERVER_ERROR with retryable=false", () => {
      const err = mapToQboError({ status: 418, body: systemFault });
      expect(err.code).toBe("QBO_SERVER_ERROR");
      expect(err.retryable).toBe(false);
    });
  });

  describe("not-found", () => {
    it("maps HTTP 404 to NOT_FOUND", () => {
      const err = mapToQboError({ status: 404 });
      expect(err.code).toBe("NOT_FOUND");
      expect(err.retryable).toBe(false);
    });

    it("maps a 400 with QBO Fault code 610 to NOT_FOUND (QBO returns 'inactive entity' as 400)", () => {
      const err = mapToQboError({ status: 400, body: objectNotFoundFault });
      expect(err.code).toBe("NOT_FOUND");
      expect(err.message).toContain("inactive");
    });
  });

  describe("validation", () => {
    it("maps 400 with ValidationFault to INVALID_INPUT for non-query calls", () => {
      const err = mapToQboError({ status: 400, body: validationFault });
      expect(err.code).toBe("INVALID_INPUT");
      expect(err.retryable).toBe(false);
    });

    it("promotes INVALID_INPUT to INVALID_QUERY when isQueryCall is set", () => {
      const err = mapToQboError({ status: 400, body: validationFault, isQueryCall: true });
      expect(err.code).toBe("INVALID_QUERY");
      expect(err.message).toContain("Encountered");
    });

    it("maps BusinessValidationFault to INVALID_INPUT", () => {
      const err = mapToQboError({ status: 400, body: businessValidationFault });
      expect(err.code).toBe("INVALID_INPUT");
      expect(err.message).toContain("already using this name");
    });
  });

  describe("preserves QBO fault payload verbatim", () => {
    it("returns the raw body under qbo_fault for downstream debugging", () => {
      const err = mapToQboError({ status: 400, body: validationFault });
      expect(err.qbo_fault).toEqual(validationFault);
    });
  });

  describe("graceful with missing or weirdly-shaped bodies", () => {
    it("handles null body", () => {
      const err = mapToQboError({ status: 500, body: null });
      expect(err.code).toBe("QBO_SERVER_ERROR");
    });

    it("handles non-object body", () => {
      const err = mapToQboError({ status: 500, body: "Internal Server Error (string)" });
      expect(err.code).toBe("QBO_SERVER_ERROR");
    });

    it("handles body with no Fault wrapper", () => {
      const err = mapToQboError({ status: 400, body: { something: "else" } });
      expect(err.code).toBe("INVALID_INPUT");
      expect(err.message).toBeTruthy();
    });
  });
});

describe("normalizeRawError", () => {
  it("extracts status, body, retry-after from an axios-shaped error", () => {
    const axiosErr = {
      response: {
        status: 429,
        data: { Fault: { type: "SystemFault" } },
        headers: { "retry-after": "60" },
      },
      message: "Request failed with status code 429",
      code: "ERR_BAD_REQUEST",
    };
    const r = normalizeRawError(axiosErr);
    expect(r).toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
      body: axiosErr.response.data,
    });
  });

  it("flags ECONNREFUSED-style errors as networkError", () => {
    const r = normalizeRawError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" });
    expect(r.networkError).toBe(true);
    expect(r.cause?.code).toBe("ECONNREFUSED");
  });

  it("falls back to message-only for plain Error", () => {
    const r = normalizeRawError(new Error("something went wrong"));
    expect(r.cause?.message).toBe("something went wrong");
    expect(r.networkError).toBeFalsy();
  });

  it("handles string errors", () => {
    const r = normalizeRawError("oops");
    expect(r.cause?.message).toBe("oops");
  });

  it("handles undefined / null without throwing", () => {
    expect(() => normalizeRawError(undefined)).not.toThrow();
    expect(() => normalizeRawError(null)).not.toThrow();
  });

  it("ignores invalid Retry-After values", () => {
    const r = normalizeRawError({
      response: { status: 429, headers: { "retry-after": "not-a-number" } },
    });
    expect(r.retryAfterSeconds).toBeUndefined();
  });
});
