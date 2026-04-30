import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import envPaths from "env-paths";

const PATHS_NAME = "qbo-mcp";
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

export interface AttachmentCacheOptions {
  cacheDir?: string;
  maxBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface CachedEntry {
  localPath: string;
  fileName: string;
  contentType: string;
  size: number;
}

interface StoredMeta {
  file_name: string;
  content_type: string;
  size: number;
  data_file: string;
}

export class AttachmentCache {
  readonly cacheDir: string;
  private readonly maxBytes: number;

  constructor(options: AttachmentCacheOptions = {}) {
    const env = options.env ?? process.env;
    this.cacheDir =
      options.cacheDir ??
      join(envPaths(PATHS_NAME, { suffix: "" }).cache, "attachments");
    const envMax = env.ATTACHMENT_CACHE_MAX_BYTES;
    this.maxBytes =
      options.maxBytes ?? (envMax ? Number.parseInt(envMax, 10) : DEFAULT_MAX_BYTES);
  }

  lookup(id: string): CachedEntry | null {
    const metaPath = join(this.cacheDir, `${id}.meta.json`);
    if (!existsSync(metaPath)) return null;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as StoredMeta;
      const dataPath = join(this.cacheDir, meta.data_file);
      if (!existsSync(dataPath)) return null;
      return {
        localPath: dataPath,
        fileName: meta.file_name,
        contentType: meta.content_type,
        size: meta.size,
      };
    } catch {
      return null;
    }
  }

  store(
    id: string,
    meta: { fileName: string; contentType: string; size: number },
    data: Buffer,
  ): CachedEntry {
    mkdirSync(this.cacheDir, { recursive: true });
    const safeName = meta.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const dataFile = `${id}_${safeName}`;
    const dataPath = join(this.cacheDir, dataFile);
    const metaPath = join(this.cacheDir, `${id}.meta.json`);

    writeFileSync(dataPath, data);
    const storedMeta: StoredMeta = {
      file_name: meta.fileName,
      content_type: meta.contentType,
      size: meta.size,
      data_file: dataFile,
    };
    writeFileSync(metaPath, JSON.stringify(storedMeta));

    this.evictIfNeeded();
    return {
      localPath: dataPath,
      fileName: meta.fileName,
      contentType: meta.contentType,
      size: meta.size,
    };
  }

  private evictIfNeeded(): void {
    const entries = this.listDataFiles();
    let totalSize = entries.reduce((sum, e) => sum + e.size, 0);
    if (totalSize <= this.maxBytes) return;

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of entries) {
      if (totalSize <= this.maxBytes) break;
      try {
        unlinkSync(entry.path);
        totalSize -= entry.size;
      } catch {
        /* already gone */
      }
      const metaFile = this.metaPathForDataFile(entry.name);
      try {
        unlinkSync(metaFile);
      } catch {
        /* already gone */
      }
    }
  }

  private metaPathForDataFile(dataFileName: string): string {
    const id = dataFileName.split("_")[0];
    return join(this.cacheDir, `${id}.meta.json`);
  }

  private listDataFiles(): Array<{
    path: string;
    name: string;
    size: number;
    mtimeMs: number;
  }> {
    try {
      const files = readdirSync(this.cacheDir);
      const result: Array<{
        path: string;
        name: string;
        size: number;
        mtimeMs: number;
      }> = [];
      for (const f of files) {
        if (f.endsWith(".meta.json")) continue;
        const p = join(this.cacheDir, f);
        try {
          const st = statSync(p);
          if (st.isFile())
            result.push({ path: p, name: f, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          /* skip broken entries */
        }
      }
      return result;
    } catch {
      return [];
    }
  }
}
