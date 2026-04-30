import "dotenv/config";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { getConfig } from "../../config-store/index.js";
import { QboClient } from "../../qbo-client/index.js";
import { handleQboQuery } from "../qbo_query.js";

const optedIn = process.env.QBO_MCP_INTEGRATION_TESTS === "1";

let hasSandboxConfig = false;
if (optedIn) {
  try {
    const config = getConfig();
    hasSandboxConfig =
      Boolean(config.tokens) &&
      Boolean(config.appCreds) &&
      config.tokens?.environment === "sandbox";
  } catch {
    hasSandboxConfig = false;
  }
}

const skip = !optedIn || !hasSandboxConfig;

describe.skipIf(skip)("qbo_query integration (sandbox)", () => {
  function buildClient(): QboClient {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");
    return new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
    });
  }

  it("happy path: SELECT * FROM Customer MAXRESULTS 5 returns up to 5 customers", async () => {
    const qbo = buildClient();
    const result = await handleQboQuery({ query: "SELECT * FROM Customer MAXRESULTS 5" }, qbo);

    expect(result.ok, result.ok ? "" : `tool returned error: ${result.error.code} - ${result.error.message}`).toBe(true);
    if (!result.ok) return;
    const value = result.value as { QueryResponse?: { Customer?: unknown[]; totalCount?: number } };
    expect(value.QueryResponse).toBeDefined();
    expect(Array.isArray(value.QueryResponse?.Customer)).toBe(true);
    expect(value.QueryResponse?.Customer?.length ?? 0).toBeLessThanOrEqual(5);
  });

  it("error path: malformed QBQL returns INVALID_QUERY with QBO's parse message", async () => {
    const qbo = buildClient();
    // Deliberately broken: incomplete WHERE clause.
    const result = await handleQboQuery({ query: "SELECT * FROM Customer WHERE" }, qbo);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_QUERY");
    expect(result.error.message).toBeTruthy();
    // QBO's parse error usually says "Encountered ..." or similar — just assert the
    // message is non-empty rather than pinning specific wording in case Intuit changes it.
    expect(result.error.qbo_status).toBe(400);
  });
});
