import type { Logger } from "pino";
import { getConfig, getPaths, type ConfigStoreOptions, type Tokens } from "../config-store/index.js";
import { getLoggerPaths, readRecentLogs, type LogEntry, type LoggerOptionsOverride } from "../logger/index.js";
import { QboClient } from "../qbo-client/index.js";

export type AuthStatus = "ok" | "expired" | "missing";

export interface DoctorReport {
  version: string;
  auth: {
    status: AuthStatus;
    environment: string | null;
    realm_id: string | null;
    expires_in_seconds: number | null;
  };
  qbo_reachable: boolean | null;
  qbo_company_name: string | null;
  last_api_call: LogEntry | null;
  last_error: LogEntry | null;
  paths: {
    config_dir: string;
    tokens_file: string;
    log_dir: string;
    log_file: string;
  };
  checks: DoctorCheck[];
}

export interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface RunDoctorDeps {
  logger: Logger;
  configStoreOptions?: ConfigStoreOptions;
  loggerOptions?: LoggerOptionsOverride;
  /** Inject a pre-built QboClient (used when the server already has one). */
  qboClient?: QboClient;
  /** Clock override for tests. */
  now?: () => number;
}

export async function runDoctor(deps: RunDoctorDeps): Promise<DoctorReport> {
  const now = deps.now ?? Date.now;
  const configPaths = getPaths(deps.configStoreOptions);
  const logPaths = getLoggerPaths(deps.loggerOptions);
  const checks: DoctorCheck[] = [];

  // 1. Config readable
  let tokens: Tokens | undefined;
  let configReadable = false;
  try {
    const config = getConfig(deps.configStoreOptions);
    tokens = config.tokens;
    configReadable = true;
    checks.push({ name: "config_readable", passed: true, message: "Config file is readable." });
  } catch (err) {
    checks.push({
      name: "config_readable",
      passed: false,
      message: `Config file unreadable: ${(err as Error).message}`,
    });
  }

  // 2. Tokens present
  const tokensPresent = configReadable && tokens !== undefined;
  if (configReadable) {
    checks.push({
      name: "tokens_present",
      passed: tokensPresent,
      message: tokensPresent
        ? "OAuth tokens are present."
        : "No OAuth tokens found. Run `npx qbo-mcp auth --env <sandbox|production>` to authorize.",
    });
  }

  // 3. Auth status + expiry
  let authStatus: AuthStatus = "missing";
  let expiresInSeconds: number | null = null;
  if (tokens) {
    const accessExpired = now() >= tokens.access_token_expires_at;
    const refreshExpired = now() >= tokens.refresh_token_expires_at;
    if (refreshExpired) {
      authStatus = "expired";
      checks.push({
        name: "tokens_not_expired",
        passed: false,
        message:
          "Refresh token has expired (100-day lifetime exceeded). Run `npx qbo-mcp auth --env " +
          tokens.environment +
          "` to re-authorize.",
      });
    } else if (accessExpired) {
      // Access token expired but refresh token still valid — server can auto-refresh.
      authStatus = "ok";
      expiresInSeconds = Math.round((tokens.refresh_token_expires_at - now()) / 1000);
      checks.push({
        name: "tokens_not_expired",
        passed: true,
        message: "Access token expired but refresh token is valid; server will auto-refresh.",
      });
    } else {
      authStatus = "ok";
      expiresInSeconds = Math.round((tokens.access_token_expires_at - now()) / 1000);
      checks.push({
        name: "tokens_not_expired",
        passed: true,
        message: `Tokens are valid. Access token expires in ${expiresInSeconds}s.`,
      });
    }
  }

  // 4. QBO reachability — ping CompanyInfo
  let qboReachable: boolean | null = null;
  let companyName: string | null = null;
  if (authStatus === "ok" && tokens) {
    try {
      const config = getConfig(deps.configStoreOptions);
      const qbo =
        deps.qboClient ??
        new QboClient({
          appCreds: config.appCreds!,
          initialTokens: tokens,
          logger: deps.logger,
        });
      const result = await qbo.getCompanyInfo<{
        CompanyInfo: { CompanyName?: string };
      }>();
      if (result.ok) {
        qboReachable = true;
        companyName = result.value?.CompanyInfo?.CompanyName ?? null;
        checks.push({ name: "qbo_reachable", passed: true, message: `QBO reachable. Company: ${companyName ?? "unknown"}.` });
      } else {
        qboReachable = false;
        checks.push({
          name: "qbo_reachable",
          passed: false,
          message: `QBO unreachable: ${result.error.message}`,
        });
      }
    } catch (err) {
      qboReachable = false;
      checks.push({
        name: "qbo_reachable",
        passed: false,
        message: `QBO reachability check threw: ${(err as Error).message}`,
      });
    }
  }

  // 5. Last API call and last error from logs
  let lastApiCall: LogEntry | null = null;
  let lastError: LogEntry | null = null;
  try {
    const recentCalls = readRecentLogs({ lines: 50 }, deps.loggerOptions);
    lastApiCall = recentCalls.find((e) => e.event === "qbo_request_ok" || e.event === "qbo_request_error") ?? null;
    lastError = recentCalls.find((e) => e.level === "error") ?? null;
  } catch {
    // Log file may not exist yet — not a failure.
  }

  // Read version from package.json at build time via the constant below.
  // We hardcode it here and the publish issue will wire it to package.json.
  const version = "0.1.0";

  return {
    version,
    auth: {
      status: authStatus,
      environment: tokens?.environment ?? null,
      realm_id: tokens?.realm_id ?? null,
      expires_in_seconds: expiresInSeconds,
    },
    qbo_reachable: qboReachable,
    qbo_company_name: companyName,
    last_api_call: lastApiCall,
    last_error: lastError,
    paths: {
      config_dir: configPaths.configDir,
      tokens_file: configPaths.tokensPath,
      log_dir: logPaths.logDir,
      log_file: logPaths.logFile,
    },
    checks,
  };
}

/**
 * Startup self-check: config readable -> tokens present -> tokens not expired
 * -> QBO reachable. Returns the report. Callers decide whether to exit or
 * continue based on check results.
 */
export async function startupSelfCheck(deps: RunDoctorDeps): Promise<DoctorReport> {
  return runDoctor(deps);
}

/** Format a DoctorReport for human-readable CLI output. */
export function formatReportForCli(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`qbo-mcp doctor v${report.version}`);
  lines.push("");

  for (const check of report.checks) {
    const icon = check.passed ? "PASS" : "FAIL";
    lines.push(`  [${icon}] ${check.name}: ${check.message}`);
  }
  lines.push("");

  lines.push(`  auth.status:       ${report.auth.status}`);
  lines.push(`  auth.environment:  ${report.auth.environment ?? "-"}`);
  lines.push(`  auth.realm_id:     ${report.auth.realm_id ?? "-"}`);
  lines.push(
    `  auth.expires_in:   ${report.auth.expires_in_seconds !== null ? `${report.auth.expires_in_seconds}s` : "-"}`,
  );
  lines.push(`  qbo_reachable:     ${report.qbo_reachable === null ? "-" : report.qbo_reachable}`);
  lines.push(`  qbo_company_name:  ${report.qbo_company_name ?? "-"}`);
  lines.push("");

  lines.push(`  config_dir:   ${report.paths.config_dir}`);
  lines.push(`  tokens_file:  ${report.paths.tokens_file}`);
  lines.push(`  log_dir:      ${report.paths.log_dir}`);
  lines.push(`  log_file:     ${report.paths.log_file}`);

  if (report.last_api_call) {
    lines.push("");
    lines.push(`  last_api_call: ${report.last_api_call.msg} (${report.last_api_call.time})`);
  }
  if (report.last_error) {
    lines.push(`  last_error:    ${report.last_error.msg} (${report.last_error.time})`);
  }

  lines.push("");
  return lines.join("\n");
}
