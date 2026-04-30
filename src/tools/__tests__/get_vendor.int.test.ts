import "dotenv/config";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { getConfig } from "../../config-store/index.js";
import { QboClient } from "../../qbo-client/index.js";
import { handleListVendors } from "../list_vendors.js";
import { handleGetVendor } from "../get_vendor.js";

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

describe.skipIf(skip)("get_vendor integration (sandbox)", () => {
  it("fetches a known vendor by Id and returns the full entity", async () => {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");

    const qbo = new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
    });

    const listResult = await handleListVendors({ limit: 1 }, qbo);
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.items.length).toBeGreaterThan(0);

    const knownId = listResult.value.items[0]!.Id as string;
    const result = await handleGetVendor({ id: knownId }, qbo);

    expect(result.ok, result.ok ? "" : `tool returned error: ${result.error.code} - ${result.error.message}`).toBe(true);
    if (!result.ok) return;

    const vendor = result.value as Record<string, unknown>;
    expect(vendor).toHaveProperty("Id", knownId);
    expect(vendor).toHaveProperty("DisplayName");
  });

  it("returns NOT_FOUND for a non-existent vendor Id", async () => {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");

    const qbo = new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
    });

    const result = await handleGetVendor({ id: "999999999" }, qbo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});
