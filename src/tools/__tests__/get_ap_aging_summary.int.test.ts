import "dotenv/config";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { getConfig } from "../../config-store/index.js";
import { QboClient } from "../../qbo-client/index.js";
import { handleGetApAgingSummary } from "../get_ap_aging_summary.js";

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

describe.skipIf(skip)("get_ap_aging_summary integration (sandbox)", () => {
  it("returns a report with Header and Rows", async () => {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");

    const qbo = new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
    });

    const result = await handleGetApAgingSummary(
      { as_of_date: "2024-12-31" },
      qbo,
    );

    expect(result.ok, result.ok ? "" : `tool returned error: ${result.error.code} - ${result.error.message}`).toBe(true);
    if (!result.ok) return;

    const report = result.value as Record<string, unknown>;
    expect(report).toHaveProperty("Header");
    expect(report).toHaveProperty("Rows");
    expect(report).toHaveProperty("Columns");
  });
});
