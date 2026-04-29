import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import envPaths from "env-paths";

export type Environment = "sandbox" | "production";

export interface Tokens {
  access_token: string;
  refresh_token: string;
  realm_id: string;
  environment: Environment;
  access_token_expires_at: number;
  refresh_token_expires_at: number;
}

export interface AppCredentials {
  client_id: string;
  client_secret: string;
}

export interface Config {
  tokens?: Tokens;
  appCreds?: AppCredentials;
}

interface FileShape {
  tokens?: Tokens;
  app_credentials?: AppCredentials;
}

export class ConfigCorruptedError extends Error {
  readonly code = "CONFIG_CORRUPTED";
  readonly backupPath: string;
  constructor(message: string, backupPath: string) {
    super(message);
    this.name = "ConfigCorruptedError";
    this.backupPath = backupPath;
  }
}

export interface ConfigStorePaths {
  configDir: string;
  tokensPath: string;
}

export interface ConfigStoreOptions {
  /** Override the env-paths-derived config dir. Used by tests. */
  configDir?: string;
  /** Override env-var lookup. Used by tests. */
  env?: NodeJS.ProcessEnv;
}

const PATHS_NAME = "qbo-mcp";

export function getPaths(options: ConfigStoreOptions = {}): ConfigStorePaths {
  const configDir = options.configDir ?? envPaths(PATHS_NAME, { suffix: "" }).config;
  return {
    configDir,
    tokensPath: join(configDir, "tokens.json"),
  };
}

function readFile(options: ConfigStoreOptions): FileShape | undefined {
  const { tokensPath } = getPaths(options);
  let raw: string;
  try {
    raw = readFileSync(tokensPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    return JSON.parse(raw) as FileShape;
  } catch {
    const backupPath = `${tokensPath}.bak.${Date.now()}`;
    renameSync(tokensPath, backupPath);
    throw new ConfigCorruptedError(
      `tokens.json contained invalid JSON; backed up to ${backupPath}. Run \`npx qbo-mcp auth\` to re-authorize.`,
      backupPath,
    );
  }
}

function readEnvCreds(env: NodeJS.ProcessEnv): AppCredentials | undefined {
  const id = env.QBO_CLIENT_ID;
  const secret = env.QBO_CLIENT_SECRET;
  if (id && secret) return { client_id: id, client_secret: secret };
  return undefined;
}

function readFileTolerant(options: ConfigStoreOptions): FileShape | undefined {
  try {
    return readFile(options);
  } catch (err) {
    if (err instanceof ConfigCorruptedError) return undefined;
    throw err;
  }
}

function atomicWrite(targetPath: string, contents: string): void {
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  const fd = openSync(tmpPath, "w", 0o600);
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, targetPath);
}

export function getConfig(options: ConfigStoreOptions = {}): Config {
  const env = options.env ?? process.env;
  const file = readFile(options);
  const envCreds = readEnvCreds(env);
  return {
    tokens: file?.tokens,
    appCreds: envCreds ?? file?.app_credentials,
  };
}

export function saveTokens(tokens: Tokens, options: ConfigStoreOptions = {}): void {
  const { configDir, tokensPath } = getPaths(options);
  mkdirSync(configDir, { recursive: true });
  const existing = readFileTolerant(options);
  const next: FileShape = { ...existing, tokens };
  atomicWrite(tokensPath, JSON.stringify(next, null, 2));
}

export function saveAppCredentials(creds: AppCredentials, options: ConfigStoreOptions = {}): void {
  const { configDir, tokensPath } = getPaths(options);
  mkdirSync(configDir, { recursive: true });
  const existing = readFileTolerant(options);
  const next: FileShape = { ...existing, app_credentials: creds };
  atomicWrite(tokensPath, JSON.stringify(next, null, 2));
}

export function clearConfig(options: ConfigStoreOptions = {}): void {
  const { tokensPath } = getPaths(options);
  try {
    unlinkSync(tokensPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
