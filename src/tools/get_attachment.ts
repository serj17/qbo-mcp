import { z } from "zod";
import type { AttachmentCache, CachedEntry } from "../attachment-cache/index.js";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getAttachmentSchema = {
  attachment_id: z
    .string()
    .describe(
      "The QBO Attachable entity ID (from list_attachments results).",
    ),
};

export type GetAttachmentInput = { attachment_id: string };

interface AttachableReadResponse {
  Attachable?: Record<string, unknown>;
}

export interface AttachmentResult {
  local_path: string;
  file_name: string;
  content_type: string;
  size: number;
}

export async function handleGetAttachment(
  input: GetAttachmentInput,
  qbo: QboClient,
  cache: AttachmentCache,
  fetchImpl?: typeof globalThis.fetch,
): Promise<Result<AttachmentResult, QboError>> {
  const cached = cache.lookup(input.attachment_id);
  if (cached) {
    return { ok: true, value: toResult(cached) };
  }

  const result = await qbo.read<AttachableReadResponse>(
    "attachable",
    input.attachment_id,
  );
  if (!result.ok) return result;
  const entity = result.value.Attachable;
  if (!entity) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Attachable with Id '${input.attachment_id}' not found.`,
        retryable: false,
      },
    };
  }

  const fileName =
    typeof entity.FileName === "string" ? entity.FileName : "attachment";
  const contentType =
    typeof entity.ContentType === "string"
      ? entity.ContentType
      : "application/octet-stream";
  const size = typeof entity.Size === "number" ? entity.Size : 0;

  const downloadUri =
    typeof entity.TempDownloadUri === "string" ? entity.TempDownloadUri : null;
  if (!downloadUri) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Attachable '${input.attachment_id}' has no downloadable file (it may be a note-only attachment).`,
        retryable: false,
      },
    };
  }

  const doFetch = fetchImpl ?? globalThis.fetch;
  let buffer: Buffer;
  try {
    const response = await doFetch(downloadUri);
    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: "QBO_SERVER_ERROR",
          message: `Failed to download attachment: HTTP ${response.status}`,
          retryable: true,
          qbo_status: response.status,
        },
      };
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: `Failed to download attachment: ${(err as Error).message}`,
        retryable: true,
      },
    };
  }

  const entry = cache.store(
    input.attachment_id,
    { fileName, contentType, size },
    buffer,
  );
  return { ok: true, value: toResult(entry) };
}

function toResult(entry: CachedEntry): AttachmentResult {
  return {
    local_path: entry.localPath,
    file_name: entry.fileName,
    content_type: entry.contentType,
    size: entry.size,
  };
}

export function createGetAttachmentTool(
  cache: AttachmentCache,
): ToolDefinition<GetAttachmentInput> {
  return {
    name: "get_attachment",
    description:
      "Download a QuickBooks attachment by its Attachable ID and return the local file path. " +
      "The file is cached locally — subsequent calls for the same ID are instant cache hits " +
      "with no network requests. Use list_attachments first to find attachment IDs for an entity, " +
      "then call this to download. After downloading, use your native file-reading capability " +
      "to inspect the content (e.g. read a PDF).",
    schema: getAttachmentSchema,
    handler: async (input, deps) => handleGetAttachment(input, deps.qbo, cache),
  };
}
