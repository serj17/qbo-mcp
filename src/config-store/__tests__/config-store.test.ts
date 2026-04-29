import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigCorruptedError,
  type Tokens,
  clearConfig,
  getConfig,
  getPaths,
  saveAppCredentials,
  saveTokens,
} from "../index.js";

const sampleTokens: Tokens = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  realm_id: "9999",
  environment: "sandbox",
  access_token_expires_at: 1_000_000,
  refresh_token_expires_at: 2_000_000,
};

describe("config-store", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "qbo-mcp-cfg-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  describe("getPaths", () => {
    it("places tokens.json inside the resolved config dir", () => {
      const paths = getPaths({ configDir });
      expect(paths.configDir).toBe(configDir);
      expect(paths.tokensPath).toBe(join(configDir, "tokens.json"));
    });
  });

  describe("getConfig with no file", () => {
    it("returns empty config when nothing has been written", () => {
      const cfg = getConfig({ configDir, env: {} });
      expect(cfg.tokens).toBeUndefined();
      expect(cfg.appCreds).toBeUndefined();
    });

    it("returns appCreds from env vars when set, with no file present", () => {
      const cfg = getConfig({
        configDir,
        env: { QBO_CLIENT_ID: "id-from-env", QBO_CLIENT_SECRET: "secret-from-env" },
      });
      expect(cfg.appCreds).toEqual({ client_id: "id-from-env", client_secret: "secret-from-env" });
    });

    it("ignores partial env-var creds (id without secret)", () => {
      const cfg = getConfig({ configDir, env: { QBO_CLIENT_ID: "only-id" } });
      expect(cfg.appCreds).toBeUndefined();
    });
  });

  describe("saveTokens + getConfig round-trip", () => {
    it("persists and reads back tokens", () => {
      saveTokens(sampleTokens, { configDir });
      const cfg = getConfig({ configDir, env: {} });
      expect(cfg.tokens).toEqual(sampleTokens);
    });

    it("creates the config dir if missing", () => {
      const nestedDir = join(configDir, "nested", "deeper");
      saveTokens(sampleTokens, { configDir: nestedDir });
      const cfg = getConfig({ configDir: nestedDir, env: {} });
      expect(cfg.tokens).toEqual(sampleTokens);
    });

    it("preserves app_credentials when saving tokens", () => {
      saveAppCredentials({ client_id: "id-file", client_secret: "secret-file" }, { configDir });
      saveTokens(sampleTokens, { configDir });
      const cfg = getConfig({ configDir, env: {} });
      expect(cfg.tokens).toEqual(sampleTokens);
      expect(cfg.appCreds).toEqual({ client_id: "id-file", client_secret: "secret-file" });
    });
  });

  describe("env-var precedence", () => {
    it("prefers env-var appCreds over file-stored values", () => {
      saveAppCredentials({ client_id: "id-file", client_secret: "secret-file" }, { configDir });
      const cfg = getConfig({
        configDir,
        env: { QBO_CLIENT_ID: "id-env", QBO_CLIENT_SECRET: "secret-env" },
      });
      expect(cfg.appCreds).toEqual({ client_id: "id-env", client_secret: "secret-env" });
    });

    it("falls back to file values when env vars are absent", () => {
      saveAppCredentials({ client_id: "id-file", client_secret: "secret-file" }, { configDir });
      const cfg = getConfig({ configDir, env: {} });
      expect(cfg.appCreds).toEqual({ client_id: "id-file", client_secret: "secret-file" });
    });
  });

  describe("atomicity", () => {
    it("does not leave the temp file behind on success", () => {
      saveTokens(sampleTokens, { configDir });
      const entries = readdirSync(configDir);
      expect(entries).toEqual(["tokens.json"]);
    });

    it("does not corrupt the existing file when overwriting", () => {
      saveTokens(sampleTokens, { configDir });
      const updated: Tokens = { ...sampleTokens, access_token: "access-new" };
      saveTokens(updated, { configDir });
      const cfg = getConfig({ configDir, env: {} });
      expect(cfg.tokens).toEqual(updated);
      const raw = readFileSync(join(configDir, "tokens.json"), "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe("corruption recovery", () => {
    it("backs up an unparseable tokens.json and throws ConfigCorruptedError on read", () => {
      const tokensPath = join(configDir, "tokens.json");
      writeFileSync(tokensPath, "{ this is not json", "utf8");

      expect(() => getConfig({ configDir, env: {} })).toThrowError(ConfigCorruptedError);

      const remaining = readdirSync(configDir);
      expect(remaining).toHaveLength(1);
      const [name] = remaining;
      expect(name).toMatch(/^tokens\.json\.bak\.\d+$/);
    });

    it("a subsequent saveTokens after corruption produces a clean tokens.json", () => {
      const tokensPath = join(configDir, "tokens.json");
      writeFileSync(tokensPath, "{ broken", "utf8");
      try {
        getConfig({ configDir, env: {} });
      } catch (err) {
        if (!(err instanceof ConfigCorruptedError)) throw err;
      }

      saveTokens(sampleTokens, { configDir });
      const cfg = getConfig({ configDir, env: {} });
      expect(cfg.tokens).toEqual(sampleTokens);
    });
  });

  describe("clearConfig", () => {
    it("removes an existing tokens.json", () => {
      saveTokens(sampleTokens, { configDir });
      clearConfig({ configDir });
      const cfg = getConfig({ configDir, env: {} });
      expect(cfg.tokens).toBeUndefined();
    });

    it("is a no-op when no tokens.json exists (no throw on ENOENT)", () => {
      expect(() => clearConfig({ configDir })).not.toThrow();
    });
  });
});
