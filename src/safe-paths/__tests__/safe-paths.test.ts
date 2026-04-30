import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SyncFolderDetectedError,
  detectSyncFolder,
  getSafeBaseDir,
} from "../index.js";

describe("safe-paths", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "qbo-mcp-paths-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("detectSyncFolder", () => {
    it("returns null for a path with no sync indicators", () => {
      const safe = join(workDir, "ordinary", "place");
      mkdirSync(safe, { recursive: true });
      const detection = detectSyncFolder(safe, { env: {} });
      expect(detection).toBeNull();
    });

    describe("OneDrive", () => {
      it("detects OneDrive via the OneDrive env var", () => {
        const oneDriveRoot = join(workDir, "OneDriveLikeDir");
        mkdirSync(oneDriveRoot, { recursive: true });
        const child = join(oneDriveRoot, "AppData", "qbo-mcp");
        const detection = detectSyncFolder(child, { env: { OneDrive: oneDriveRoot } });
        expect(detection).toEqual({
          provider: "OneDrive",
          ancestor: oneDriveRoot,
          marker: "env:OneDrive",
        });
      });

      it("detects OneDrive via the OneDriveCommercial env var", () => {
        const root = join(workDir, "BizDir");
        mkdirSync(root, { recursive: true });
        const child = join(root, "qbo-mcp");
        const detection = detectSyncFolder(child, { env: { OneDriveCommercial: root } });
        expect(detection).toMatchObject({
          provider: "OneDrive",
          marker: "env:OneDriveCommercial",
        });
      });

      it("detects OneDrive by ancestor directory name (consumer)", () => {
        const root = join(workDir, "Users", "alice", "OneDrive");
        const child = join(root, "Documents", "qbo-mcp");
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: {} });
        expect(detection?.provider).toBe("OneDrive");
        expect(detection?.ancestor).toBe(root);
        expect(detection?.marker).toBeUndefined();
      });

      it("detects OneDrive by ancestor directory name (business with org suffix)", () => {
        const root = join(workDir, "Users", "alice", "OneDrive - Contoso");
        const child = join(root, "qbo-mcp");
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: {} });
        expect(detection?.provider).toBe("OneDrive");
        expect(detection?.ancestor).toBe(root);
      });

      it("does not match an ancestor merely containing the substring", () => {
        const root = join(workDir, "MyOneDriveBackups");
        const child = join(root, "qbo-mcp");
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: {} });
        expect(detection).toBeNull();
      });
    });

    describe("Dropbox", () => {
      it("detects Dropbox by ancestor directory name", () => {
        const root = join(workDir, "Users", "alice", "Dropbox");
        const child = join(root, "qbo-mcp");
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: {} });
        expect(detection?.provider).toBe("Dropbox");
        expect(detection?.ancestor).toBe(root);
      });

      it("detects Dropbox by .dropbox marker file in an ancestor", () => {
        const root = join(workDir, "MyStuff");
        const child = join(root, "config", "qbo-mcp");
        mkdirSync(child, { recursive: true });
        writeFileSync(join(root, ".dropbox"), "marker");
        const detection = detectSyncFolder(child, { env: {} });
        expect(detection).toMatchObject({
          provider: "Dropbox",
          ancestor: root,
          marker: ".dropbox",
        });
      });

      it("detects Dropbox by .dropbox.cache directory in an ancestor", () => {
        const root = join(workDir, "anotherRoot");
        const child = join(root, "qbo-mcp");
        mkdirSync(join(root, ".dropbox.cache"), { recursive: true });
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: {} });
        expect(detection).toMatchObject({
          provider: "Dropbox",
          ancestor: root,
          marker: ".dropbox.cache",
        });
      });
    });

    describe("Google Drive", () => {
      it("detects Google Drive by ancestor name", () => {
        const root = join(workDir, "Users", "alice", "Google Drive");
        const child = join(root, "AppData", "qbo-mcp");
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: {} });
        expect(detection?.provider).toBe("GoogleDrive");
        expect(detection?.ancestor).toBe(root);
      });

      it("detects Google Drive when path has no space (GoogleDrive)", () => {
        const root = join(workDir, "GoogleDrive");
        const child = join(root, "qbo-mcp");
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: {} });
        expect(detection?.provider).toBe("GoogleDrive");
      });

      it("detects 'My Drive' (Drive for Desktop's mounted root)", () => {
        const root = join(workDir, "GoogleStuff", "My Drive");
        const child = join(root, "qbo-mcp");
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: {} });
        expect(detection?.provider).toBe("GoogleDrive");
      });
    });

    describe("iCloud", () => {
      it("detects iCloud by path under ~/Library/Mobile Documents", () => {
        const home = workDir;
        const iCloud = join(home, "Library", "Mobile Documents");
        const child = join(iCloud, "iCloud~com~example", "qbo-mcp");
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: { HOME: home } });
        expect(detection).toEqual({
          provider: "iCloud",
          ancestor: iCloud,
        });
      });

      it("respects USERPROFILE on Windows-shaped envs", () => {
        const home = workDir;
        const iCloud = join(home, "Library", "Mobile Documents");
        const child = join(iCloud, "qbo-mcp");
        mkdirSync(child, { recursive: true });
        const detection = detectSyncFolder(child, { env: { USERPROFILE: home } });
        expect(detection?.provider).toBe("iCloud");
      });
    });

    describe("walk termination", () => {
      it("does not infinite-loop on malformed paths", () => {
        const detection = detectSyncFolder(workDir, { env: {} });
        expect(detection).toBeNull();
      });
    });
  });

  describe("getSafeBaseDir", () => {
    it("uses options.baseDirOverride and skips the check", () => {
      const overridden = join(workDir, "OneDrive", "qbo-mcp"); // would normally trip the detector
      mkdirSync(overridden, { recursive: true });
      const result = getSafeBaseDir({ baseDirOverride: overridden, env: {} });
      expect(result).toEqual({ baseDir: overridden, override: true });
    });

    it("uses QBO_MCP_CONFIG_DIR env var and skips the check", () => {
      const overridden = join(workDir, "OneDrive", "qbo-mcp");
      mkdirSync(overridden, { recursive: true });
      const result = getSafeBaseDir({ env: { QBO_MCP_CONFIG_DIR: overridden } });
      expect(result).toEqual({ baseDir: overridden, override: true });
    });
  });

  describe("SyncFolderDetectedError", () => {
    it("carries provider, ancestor, marker, and resolvedPath fields", () => {
      const err = new SyncFolderDetectedError(
        { provider: "Dropbox", ancestor: "/foo", marker: ".dropbox" },
        "/foo/bar/qbo-mcp",
      );
      expect(err.code).toBe("SYNC_FOLDER_DETECTED");
      expect(err.provider).toBe("Dropbox");
      expect(err.ancestor).toBe("/foo");
      expect(err.marker).toBe(".dropbox");
      expect(err.resolvedPath).toBe("/foo/bar/qbo-mcp");
      expect(err.message).toContain("Dropbox");
      expect(err.message).toContain("QBO_MCP_CONFIG_DIR");
    });
  });
});
