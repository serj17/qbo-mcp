import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REVOKE_HELP_TEXT,
  parseRevokeArgs,
  runRevoke,
} from "../revoke.js";
import type { AppCredentials, Tokens } from "../../config-store/index.js";

const sampleCreds: AppCredentials = { client_id: "AB123", client_secret: "secret-x" };
const sampleTokens: Tokens = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  realm_id: "9999",
  environment: "sandbox",
  access_token_expires_at: 1_000_000,
  refresh_token_expires_at: 2_000_000,
};

function mockResponse(status: number, body = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

describe("parseRevokeArgs", () => {
  it("defaults to keepConfig=false, no help requested", () => {
    expect(parseRevokeArgs([])).toEqual({ keepConfig: false, helpRequested: false });
  });

  it("turns on --keep-config", () => {
    expect(parseRevokeArgs(["--keep-config"]).keepConfig).toBe(true);
  });

  it("flags help requests", () => {
    expect(parseRevokeArgs(["--help"]).helpRequested).toBe(true);
    expect(parseRevokeArgs(["-h"]).helpRequested).toBe(true);
  });

  it("rejects unknown flags", () => {
    expect(() => parseRevokeArgs(["--whatever"])).toThrow(/Unknown revoke flag/);
  });
});

describe("REVOKE_HELP_TEXT", () => {
  it("mentions --keep-config and the re-auth follow-up", () => {
    expect(REVOKE_HELP_TEXT).toContain("--keep-config");
    expect(REVOKE_HELP_TEXT).toMatch(/qbo-mcp auth/);
  });
});

describe("runRevoke HTTP behavior", () => {
  it("POSTs to the revoke endpoint with HTTP Basic auth and the refresh token in the body", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return mockResponse(200);
    }) as unknown as typeof fetch;

    const result = await runRevoke({
      appCreds: sampleCreds,
      tokens: sampleTokens,
      keepConfig: true, // skip the clearConfig side effect for the URL check
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(captured?.url).toBe("https://developer.api.intuit.com/v2/oauth2/tokens/revoke");
    expect(captured?.init.method).toBe("POST");

    const headers = captured?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("AB123:secret-x").toString("base64")}`,
    );
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(captured?.init.body as string) as { token: string };
    expect(body.token).toBe("refresh-xyz");
  });

  it("on 4xx returns a typed REVOKE_HTTP_ERROR with status and excerpt", async () => {
    const fetchImpl = vi.fn(async () => mockResponse(400, "invalid_grant"));
    const result = await runRevoke({
      appCreds: sampleCreds,
      tokens: sampleTokens,
      keepConfig: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("REVOKE_HTTP_ERROR");
    expect(result.status).toBe(400);
    expect(result.message).toContain("invalid_grant");
  });

  it("on network failure returns REVOKE_NETWORK_ERROR with the cause message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await runRevoke({
      appCreds: sampleCreds,
      tokens: sampleTokens,
      keepConfig: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("REVOKE_NETWORK_ERROR");
    expect(result.message).toContain("ECONNREFUSED");
  });
});

describe("runRevoke local file clearing", () => {
  it("does NOT delete tokens.json on HTTP failure", async () => {
    // Set up a fake config dir with a tokens.json so we can verify it's untouched.
    const cfgDir = mkdtempSync(join(tmpdir(), "qbo-mcp-revoke-"));
    const tokensPath = join(cfgDir, "tokens.json");
    require("node:fs").writeFileSync(tokensPath, JSON.stringify({ tokens: sampleTokens }));
    const prevConfigDir = process.env.QBO_MCP_CONFIG_DIR;
    process.env.QBO_MCP_CONFIG_DIR = cfgDir;
    try {
      const fetchImpl = vi.fn(async () => mockResponse(500, "server fail"));
      const result = await runRevoke({
        appCreds: sampleCreds,
        tokens: sampleTokens,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      // tokens.json should still exist — failure path does not touch local file
      expect(existsSync(tokensPath)).toBe(true);
      const persisted = JSON.parse(readFileSync(tokensPath, "utf8")) as { tokens: Tokens };
      expect(persisted.tokens.refresh_token).toBe("refresh-xyz");
    } finally {
      if (prevConfigDir === undefined) delete process.env.QBO_MCP_CONFIG_DIR;
      else process.env.QBO_MCP_CONFIG_DIR = prevConfigDir;
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  it("does NOT delete tokens.json when --keep-config (cleared=false)", async () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "qbo-mcp-revoke-"));
    const tokensPath = join(cfgDir, "tokens.json");
    require("node:fs").writeFileSync(tokensPath, JSON.stringify({ tokens: sampleTokens }));
    const prevConfigDir = process.env.QBO_MCP_CONFIG_DIR;
    process.env.QBO_MCP_CONFIG_DIR = cfgDir;
    try {
      const fetchImpl = vi.fn(async () => mockResponse(200));
      const result = await runRevoke({
        appCreds: sampleCreds,
        tokens: sampleTokens,
        keepConfig: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result).toEqual({ ok: true, cleared: false });
      expect(existsSync(tokensPath)).toBe(true);
    } finally {
      if (prevConfigDir === undefined) delete process.env.QBO_MCP_CONFIG_DIR;
      else process.env.QBO_MCP_CONFIG_DIR = prevConfigDir;
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  it("DOES delete tokens.json on successful revoke without --keep-config", async () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "qbo-mcp-revoke-"));
    const tokensPath = join(cfgDir, "tokens.json");
    require("node:fs").writeFileSync(tokensPath, JSON.stringify({ tokens: sampleTokens }));
    const prevConfigDir = process.env.QBO_MCP_CONFIG_DIR;
    process.env.QBO_MCP_CONFIG_DIR = cfgDir;
    try {
      const fetchImpl = vi.fn(async () => mockResponse(200));
      const result = await runRevoke({
        appCreds: sampleCreds,
        tokens: sampleTokens,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result).toEqual({ ok: true, cleared: true });
      expect(existsSync(tokensPath)).toBe(false);
    } finally {
      if (prevConfigDir === undefined) delete process.env.QBO_MCP_CONFIG_DIR;
      else process.env.QBO_MCP_CONFIG_DIR = prevConfigDir;
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});
