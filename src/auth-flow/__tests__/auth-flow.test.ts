import { describe, expect, it } from "vitest";
import { AUTH_HELP_TEXT, parseAuthArgs } from "../cli.js";
import {
  buildRedirectUri,
  defaultGenerateState,
  parseCallbackUrl,
} from "../index.js";

describe("auth-flow CLI parser", () => {
  it("defaults to sandbox, no manual, port 8080", () => {
    expect(parseAuthArgs([])).toEqual({
      environment: "sandbox",
      manual: false,
      port: 8080,
      helpRequested: false,
    });
  });

  it("accepts --env sandbox / --env production", () => {
    expect(parseAuthArgs(["--env", "sandbox"]).environment).toBe("sandbox");
    expect(parseAuthArgs(["--env", "production"]).environment).toBe("production");
  });

  it("accepts --env=production form", () => {
    expect(parseAuthArgs(["--env=production"]).environment).toBe("production");
  });

  it("rejects bogus --env values", () => {
    expect(() => parseAuthArgs(["--env", "qa"])).toThrow(/--env must be/);
    expect(() => parseAuthArgs(["--env="])).toThrow(/--env must be/);
  });

  it("accepts --port and --port=N", () => {
    expect(parseAuthArgs(["--port", "9000"]).port).toBe(9000);
    expect(parseAuthArgs(["--port=9001"]).port).toBe(9001);
  });

  it("rejects out-of-range or non-numeric --port", () => {
    expect(() => parseAuthArgs(["--port", "0"])).toThrow(/--port must be/);
    expect(() => parseAuthArgs(["--port", "70000"])).toThrow(/--port must be/);
    expect(() => parseAuthArgs(["--port", "abc"])).toThrow(/--port must be/);
  });

  it("turns on manual mode with --manual", () => {
    expect(parseAuthArgs(["--manual"]).manual).toBe(true);
  });

  it("flags help requests rather than throwing", () => {
    expect(parseAuthArgs(["--help"]).helpRequested).toBe(true);
    expect(parseAuthArgs(["-h"]).helpRequested).toBe(true);
  });

  it("rejects unknown flags", () => {
    expect(() => parseAuthArgs(["--whatever"])).toThrow(/Unknown auth flag/);
  });

  it("composes flags in any order", () => {
    expect(parseAuthArgs(["--manual", "--env=production", "--port=9090"])).toEqual({
      environment: "production",
      manual: true,
      port: 9090,
      helpRequested: false,
    });
  });

  it("AUTH_HELP_TEXT mentions both required env vars and the override", () => {
    expect(AUTH_HELP_TEXT).toContain("QBO_CLIENT_ID");
    expect(AUTH_HELP_TEXT).toContain("QBO_CLIENT_SECRET");
    expect(AUTH_HELP_TEXT).toContain("QBO_MCP_CONFIG_DIR");
  });
});

describe("buildRedirectUri", () => {
  it("produces the canonical localhost URL with default path", () => {
    expect(buildRedirectUri("localhost", 8080)).toBe("http://localhost:8080/callback");
  });

  it("honors a non-default port", () => {
    expect(buildRedirectUri("localhost", 8081)).toBe("http://localhost:8081/callback");
  });

  it("honors a non-default host (used by tests)", () => {
    expect(buildRedirectUri("127.0.0.1", 8080)).toBe("http://127.0.0.1:8080/callback");
  });
});

describe("defaultGenerateState", () => {
  it("returns a 32-character hex string (16 random bytes)", () => {
    const s = defaultGenerateState();
    expect(s).toHaveLength(32);
    expect(s).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns different values on repeated calls", () => {
    const a = defaultGenerateState();
    const b = defaultGenerateState();
    expect(a).not.toBe(b);
  });
});

describe("parseCallbackUrl", () => {
  it("extracts code, state, and realmId from a happy-path URL", () => {
    const url =
      "http://localhost:8080/callback?code=ABC&state=deadbeef&realmId=9999";
    const r = parseCallbackUrl(url);
    expect(r).toEqual({ ok: true, code: "ABC", state: "deadbeef", realmId: "9999" });
  });

  it("accepts a path-with-query (what users may paste in --manual)", () => {
    const r = parseCallbackUrl("/callback?code=ABC&state=deadbeef&realmId=9999");
    expect(r).toEqual({ ok: true, code: "ABC", state: "deadbeef", realmId: "9999" });
  });

  it("returns the OAuth error when Intuit redirects with one", () => {
    const url = "http://localhost:8080/callback?error=access_denied&error_description=User%20canceled";
    const r = parseCallbackUrl(url);
    expect(r).toMatchObject({ ok: false, error: "access_denied" });
    expect(("errorDescription" in r ? r.errorDescription : "")).toContain("User canceled");
  });

  it("rejects URLs missing required params", () => {
    const r = parseCallbackUrl("http://localhost:8080/callback?code=ABC&state=xxx");
    expect(r).toMatchObject({ ok: false, error: "missing_params" });
  });

  it("rejects strings that are not URL-shaped", () => {
    const r = parseCallbackUrl("not a url at all");
    expect(r.ok).toBe(false);
  });
});
