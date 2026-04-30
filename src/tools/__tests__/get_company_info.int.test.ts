import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import pino from "pino";
import { getConfig } from "../../config-store/index.js";
import { QboClient } from "../../qbo-client/index.js";
import { clearCompanyInfoCache, handleGetCompanyInfo } from "../get_company_info.js";

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

describe.skipIf(skip)("get_company_info integration (sandbox)", () => {
  afterEach(() => {
    clearCompanyInfoCache();
  });

  it("returns a valid CompanyInfo shape", async () => {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");

    const qbo = new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
    });

    const result = await handleGetCompanyInfo({} as Record<string, never>, qbo);

    expect(result.ok, result.ok ? "" : `tool returned error: ${result.error.code} - ${result.error.message}`).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveProperty("company_name");
    expect(typeof result.value.company_name).toBe("string");
    expect(result.value.company_name.length).toBeGreaterThan(0);
    expect(result.value).toHaveProperty("legal_name");
    expect(result.value).toHaveProperty("country");
    expect(result.value).toHaveProperty("fiscal_year_start_month");
    expect(result.value).toHaveProperty("raw");
    expect(typeof result.value.raw).toBe("object");
  });

  it("returns cached result on second call without hitting QBO again", async () => {
    const config = getConfig();
    if (!config.tokens || !config.appCreds) throw new Error("test precondition: config missing");

    let fetchCount = 0;
    const countingFetch: typeof fetch = async (...args) => {
      fetchCount++;
      return fetch(...args);
    };

    const qbo = new QboClient({
      appCreds: config.appCreds,
      initialTokens: config.tokens,
      logger: pino({ level: "silent" }),
      fetchImpl: countingFetch,
    });

    const first = await handleGetCompanyInfo({} as Record<string, never>, qbo);
    expect(first.ok).toBe(true);
    const fetchAfterFirst = fetchCount;

    const second = await handleGetCompanyInfo({} as Record<string, never>, qbo);
    expect(second.ok).toBe(true);
    expect(fetchCount).toBe(fetchAfterFirst);

    if (first.ok && second.ok) {
      expect(second.value).toEqual(first.value);
    }
  });
});
