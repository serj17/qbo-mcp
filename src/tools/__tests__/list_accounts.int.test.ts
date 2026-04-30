import "dotenv/config";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { getConfig } from "../../config-store/index.js";
import { QboClient } from "../../qbo-client/index.js";
import { handleListAccounts } from "../list_accounts.js";

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

describe.skipIf(skip)("list_accounts integration (sandbox)", () => {
  it("returns up to 5 accounts with the documented page_info shape", async () => {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");

    const qbo = new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
    });

    const result = await handleListAccounts({ limit: 5 }, qbo);

    expect(result.ok, result.ok ? "" : `tool returned error: ${result.error.code} - ${result.error.message}`).toBe(true);
    if (!result.ok) return;

    expect(Array.isArray(result.value.items)).toBe(true);
    expect(result.value.items.length).toBeLessThanOrEqual(5);
    expect(result.value.page_info.returned_count).toBe(result.value.items.length);
    expect(typeof result.value.page_info.has_more).toBe("boolean");
    expect(result.value.page_info.total_count).toEqual(expect.any(Number));

    if (result.value.items.length > 0) {
      expect(result.value.items[0]).toHaveProperty("Id");
    }
  });

  it("count_only returns total without items", async () => {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");

    const qbo = new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
    });

    const result = await handleListAccounts({ count_only: true }, qbo);

    expect(result.ok, result.ok ? "" : `tool returned error: ${result.error.code} - ${result.error.message}`).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toEqual([]);
    expect(result.value.page_info).toMatchObject({
      total_count: expect.any(Number),
      returned_count: 0,
      has_more: false,
      next_cursor: null,
    });
  });
});
