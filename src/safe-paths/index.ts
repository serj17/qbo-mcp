import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, normalize, sep } from "node:path";
import envPaths from "env-paths";

export type SyncProvider = "OneDrive" | "Dropbox" | "iCloud" | "GoogleDrive";

export interface SyncDetection {
  provider: SyncProvider;
  /** Absolute path of the sync-folder ancestor (or marker file path). */
  ancestor: string;
  /** What triggered detection: env var name, marker filename, or undefined for name-match. */
  marker?: string;
}

export class SyncFolderDetectedError extends Error {
  readonly code = "SYNC_FOLDER_DETECTED";
  readonly provider: SyncProvider;
  readonly ancestor: string;
  readonly marker?: string;
  readonly resolvedPath: string;
  constructor(detection: SyncDetection, resolvedPath: string) {
    const msg =
      `qbo-mcp config dir resolved to ${resolvedPath}, which is inside a ${detection.provider} ` +
      `sync folder (${detection.ancestor}${detection.marker ? ` via ${detection.marker}` : ""}). ` +
      `Tokens stored here would be replicated to ${detection.provider}'s servers — that's a leak. ` +
      `Set the QBO_MCP_CONFIG_DIR env var to a path outside any cloud-sync folder to override.`;
    super(msg);
    this.name = "SyncFolderDetectedError";
    this.provider = detection.provider;
    this.ancestor = detection.ancestor;
    this.marker = detection.marker;
    this.resolvedPath = resolvedPath;
  }
}

const PATHS_NAME = "qbo-mcp";

interface DetectorOptions {
  env?: NodeJS.ProcessEnv;
}

function pathStartsWith(child: string, parent: string): boolean {
  const normChild = normalize(child).toLowerCase();
  const normParent = normalize(parent).toLowerCase();
  if (normChild === normParent) return true;
  return normChild.startsWith(normParent.endsWith(sep) ? normParent : normParent + sep);
}

function existsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk from `absPath` upward and decide whether any ancestor is inside a
 * known cloud-sync provider. Three signal sources, checked in order:
 *
 *   1. Provider-specific env vars (OneDrive on Windows sets these)
 *   2. Path prefix conventions (iCloud on macOS lives under
 *      ~/Library/Mobile Documents/)
 *   3. Ancestor directory-name match or marker-file presence (Dropbox's
 *      .dropbox, name "Google Drive", etc.)
 */
export function detectSyncFolder(
  absPath: string,
  options: DetectorOptions = {},
): SyncDetection | null {
  const env = options.env ?? process.env;

  // OneDrive: env-var roots (Windows). Covers consumer + business OneDrive,
  // including business accounts where the path is "OneDrive - Contoso".
  for (const ev of ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]) {
    const root = env[ev];
    if (root && pathStartsWith(absPath, root)) {
      return { provider: "OneDrive", ancestor: root, marker: `env:${ev}` };
    }
  }

  // iCloud: macOS path convention.
  const home = env.HOME ?? env.USERPROFILE;
  if (home) {
    const iCloudRoot = join(home, "Library", "Mobile Documents");
    if (pathStartsWith(absPath, iCloudRoot)) {
      return { provider: "iCloud", ancestor: iCloudRoot };
    }
  }

  // Walk up checking ancestor dir names and marker files.
  let current = normalize(absPath);
  // Cap the walk so a malformed path can't infinite-loop.
  for (let i = 0; i < 64; i++) {
    const name = basename(current);

    // OneDrive name match (case-insensitive). Matches "OneDrive",
    // "OneDrive - Foo", "OneDrive_Bar" but not "MyOneDrive".
    if (/^OneDrive(?:[\s_-].*)?$/i.test(name)) {
      return { provider: "OneDrive", ancestor: current };
    }

    if (/^Dropbox$/i.test(name)) {
      return { provider: "Dropbox", ancestor: current };
    }

    if (/^(?:Google Drive|GoogleDrive|My Drive)$/i.test(name)) {
      return { provider: "GoogleDrive", ancestor: current };
    }

    // Dropbox marker files.
    if (existsSync(join(current, ".dropbox"))) {
      return { provider: "Dropbox", ancestor: current, marker: ".dropbox" };
    }
    if (existsDir(join(current, ".dropbox.cache"))) {
      return { provider: "Dropbox", ancestor: current, marker: ".dropbox.cache" };
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

export interface SafeBaseDirOptions {
  env?: NodeJS.ProcessEnv;
  /** Override the env-paths-derived base dir. Used by tests. */
  baseDirOverride?: string;
}

export interface SafeBaseDirResult {
  baseDir: string;
  /** True when the caller used QBO_MCP_CONFIG_DIR to opt into a custom location. */
  override: boolean;
}

/**
 * Resolve the base directory the rest of the app should write into.
 *
 * Precedence:
 *   1. options.baseDirOverride (tests)
 *   2. QBO_MCP_CONFIG_DIR env var (treated as "user opted in" — no sync check)
 *   3. env-paths-derived config dir, with a sync-folder check applied
 *
 * Throws SyncFolderDetectedError when (3) lands inside a known cloud-sync
 * folder. Caller is expected to catch and exit cleanly with a message.
 */
export function getSafeBaseDir(options: SafeBaseDirOptions = {}): SafeBaseDirResult {
  const env = options.env ?? process.env;

  if (options.baseDirOverride) {
    return { baseDir: options.baseDirOverride, override: true };
  }

  const explicit = env.QBO_MCP_CONFIG_DIR;
  if (explicit) {
    return { baseDir: explicit, override: true };
  }

  const baseDir = envPaths(PATHS_NAME, { suffix: "" }).config;
  const detection = detectSyncFolder(baseDir, { env });
  if (detection) {
    throw new SyncFolderDetectedError(detection, baseDir);
  }
  return { baseDir, override: false };
}
