import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDoctor, formatReportForCli, type RunDoctorDeps } from "../index.js";
import { getLogger, resetLogger, appendRawLogLine } from "../../logger/index.js";
import type { Tokens } from "../../config-store/index.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `doctor-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTokens(overrides: Partial<Tokens> = {}): Tokens {
  const now = Date.now();
  return {
    access_token: "at-test",
    refresh_token: "rt-test",
    realm_id: "1234",
    environment: "sandbox",
    access_token_expires_at: now + 3600_000,
    refresh_token_expires_at: now + 8_640_000_000,
    ...overrides,
  };
}

describe("runDoctor", () => {
  let configDir: string;
  let logDir: string;

  beforeEach(() => {
    configDir = makeTmpDir();
    logDir = makeTmpDir();
    resetLogger();
  });

  afterEach(() => {
    resetLogger();
    rmSync(configDir, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  function baseDeps(): RunDoctorDeps {
    return {
      logger: getLogger({ logDir }),
      configStoreOptions: { configDir },
      loggerOptions: { logDir },
    };
  }

  it("reports missing tokens when config file does not exist", async () => {
    const report = await runDoctor(baseDeps());

    expect(report.auth.status).toBe("missing");
    expect(report.auth.expires_in_seconds).toBeNull();
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "tokens_present", passed: false }),
    );
    expect(report.qbo_reachable).toBeNull();
  });

  it("reports ok auth when tokens are valid", async () => {
    const tokens = makeTokens();
    writeFileSync(
      join(configDir, "tokens.json"),
      JSON.stringify({
        tokens,
        app_credentials: { client_id: "cid", client_secret: "csec" },
      }),
    );

    const report = await runDoctor({
      ...baseDeps(),
      // Skip the actual QBO call by not providing a qboClient and letting
      // it fail gracefully (no real credentials).
    });

    expect(report.auth.status).toBe("ok");
    expect(report.auth.realm_id).toBe("1234");
    expect(report.auth.environment).toBe("sandbox");
    expect(report.auth.expires_in_seconds).toBeGreaterThan(0);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "tokens_not_expired", passed: true }),
    );
  });

  it("reports expired auth when refresh token is expired", async () => {
    const tokens = makeTokens({
      access_token_expires_at: Date.now() - 7200_000,
      refresh_token_expires_at: Date.now() - 1000,
    });
    writeFileSync(
      join(configDir, "tokens.json"),
      JSON.stringify({ tokens }),
    );

    const report = await runDoctor(baseDeps());

    expect(report.auth.status).toBe("expired");
    expect(report.auth.expires_in_seconds).toBeNull();
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "tokens_not_expired", passed: false }),
    );
    expect(report.qbo_reachable).toBeNull();
  });

  it("reports ok when access token expired but refresh token valid", async () => {
    const tokens = makeTokens({
      access_token_expires_at: Date.now() - 1000,
      refresh_token_expires_at: Date.now() + 8_640_000_000,
    });
    writeFileSync(
      join(configDir, "tokens.json"),
      JSON.stringify({
        tokens,
        app_credentials: { client_id: "cid", client_secret: "csec" },
      }),
    );

    const report = await runDoctor(baseDeps());

    expect(report.auth.status).toBe("ok");
    expect(report.auth.expires_in_seconds).toBeGreaterThan(0);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "tokens_not_expired",
        passed: true,
        message: expect.stringContaining("auto-refresh"),
      }),
    );
  });

  it("includes paths in report", async () => {
    const report = await runDoctor(baseDeps());

    expect(report.paths.config_dir).toBe(configDir);
    expect(report.paths.log_dir).toBe(logDir);
    expect(report.paths.tokens_file).toContain("tokens.json");
    expect(report.paths.log_file).toContain("qbo-mcp.log");
  });

  it("includes version", async () => {
    const report = await runDoctor(baseDeps());
    expect(report.version).toBe("0.1.0");
  });

  it("picks up last error from logs", async () => {
    appendRawLogLine(
      JSON.stringify({
        level: 50,
        time: "2026-01-01T00:00:00.000Z",
        msg: "something broke",
        event: "tool_call_error",
        tool: "list_invoices",
      }),
      { logDir },
    );

    const report = await runDoctor(baseDeps());
    expect(report.last_error).not.toBeNull();
    expect(report.last_error!.msg).toBe("something broke");
  });

  it("picks up last api call from logs", async () => {
    appendRawLogLine(
      JSON.stringify({
        level: 30,
        time: "2026-01-01T00:00:01.000Z",
        msg: "qbo query ok",
        event: "qbo_request_ok",
        op: "query",
      }),
      { logDir },
    );

    const report = await runDoctor(baseDeps());
    expect(report.last_api_call).not.toBeNull();
    expect(report.last_api_call!.event).toBe("qbo_request_ok");
  });
});

describe("formatReportForCli", () => {
  it("formats a basic report without crashing", async () => {
    const configDir = makeTmpDir();
    const logDir = makeTmpDir();
    resetLogger();

    try {
      const report = await runDoctor({
        logger: getLogger({ logDir }),
        configStoreOptions: { configDir },
        loggerOptions: { logDir },
      });
      const output = formatReportForCli(report);

      expect(output).toContain("qbo-mcp doctor v0.1.0");
      expect(output).toContain("FAIL");
      expect(output).toContain("tokens_present");
    } finally {
      resetLogger();
      rmSync(configDir, { recursive: true, force: true });
      rmSync(logDir, { recursive: true, force: true });
    }
  });
});
