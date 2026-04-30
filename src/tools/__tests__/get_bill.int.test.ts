import "dotenv/config";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { getConfig } from "../../config-store/index.js";
import { QboClient } from "../../qbo-client/index.js";
import { handleListBills } from "../list_bills.js";
import { handleGetBill } from "../get_bill.js";

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

describe.skipIf(skip)("get_bill integration (sandbox)", () => {
  it("fetches a known bill by Id and returns the full entity", async () => {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");

    const qbo = new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
    });

    const listResult = await handleListBills({ limit: 1 }, qbo);
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.items.length).toBeGreaterThan(0);

    const knownId = listResult.value.items[0]!.Id as string;
    const result = await handleGetBill({ id: knownId }, qbo);

    expect(result.ok, result.ok ? "" : `tool returned error: ${result.error.code} - ${result.error.message}`).toBe(true);
    if (!result.ok) return;

    const bill = result.value as Record<string, unknown>;
    expect(bill).toHaveProperty("Id", knownId);
    expect(bill).toHaveProperty("Line");
    expect(bill).toHaveProperty("TotalAmt");
  });

  it("returns NOT_FOUND for a non-existent bill Id", async () => {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");

    const qbo = new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
    });

    const result = await handleGetBill({ id: "999999999" }, qbo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});
