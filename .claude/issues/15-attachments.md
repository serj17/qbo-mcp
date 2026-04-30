## Parent

#1

## What to build

The full attachment reading path: the `attachment-cache` deep module, `list_attachments` MCP tool, and `get_attachment` MCP tool. Lets Claude read PDFs and images attached to QBO entities (bills, invoices, etc.) to answer questions like "what's on the receipt for this bill?".

`attachment-cache` is a local file cache for downloaded files at `<env-paths>/cache/attachments/`. LRU eviction by total size cap (default 500 MB). Public interface: `getOrDownload(attachmentId)` returns the local file path, downloading via QBO's signed URL only on cache miss.

`list_attachments({ entity_type, entity_id })` returns metadata for all attachments linked to the given entity: `{ id, file_name, file_access_uri, content_type, size, note? }[]`. Reads from the QBO `Attachable` entity, filtered by `AttachableRef.EntityRef`.

`get_attachment({ attachment_id })` ensures the file is locally cached and returns `{ local_path, file_name, content_type, size }`. Claude then reads the PDF via its native Read tool — we don't try to inline base64 in the response.

## Acceptance criteria

- [x] `attachment-cache.getOrDownload(id)` resolves QBO signed URL, downloads via streaming, returns local path
- [x] LRU eviction triggers when total cache size exceeds `ATTACHMENT_CACHE_MAX_BYTES` env var (default 500 MB); evicts oldest by mtime until under cap
- [x] Cache directory auto-created on first use
- [x] `list_attachments` returns the metadata array (not the QBO Attachable wrapper); empty array if none
- [x] `list_attachments` errors gracefully on bad `entity_type` (typed as enum in the Zod schema)
- [x] `get_attachment` returns the local path; second call for the same id is a cache hit (no network)
- [x] One sandbox integration test: upload a PDF to a sandbox bill out-of-band, then `list_attachments` and `get_attachment` against it; or rely on a known-attachment fixture in the sandbox

## Blocked by

- Blocked by #8
