import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

const ENTITY_TYPES = [
  "Invoice",
  "Bill",
  "Estimate",
  "PurchaseOrder",
  "SalesReceipt",
  "CreditMemo",
  "Payment",
  "Purchase",
  "JournalEntry",
  "Transfer",
  "VendorCredit",
  "Deposit",
  "RefundReceipt",
  "BillPayment",
] as const;

export const listAttachmentsSchema = {
  entity_type: z
    .enum(ENTITY_TYPES)
    .describe(
      "The QBO entity type (e.g. 'Invoice', 'Bill'). Case-sensitive — use exactly the values listed.",
    ),
  entity_id: z
    .string()
    .describe("The QBO entity ID to list attachments for."),
};

export type ListAttachmentsInput = {
  entity_type: (typeof ENTITY_TYPES)[number];
  entity_id: string;
};

export interface AttachmentMetadata {
  id: string;
  file_name: string | null;
  content_type: string | null;
  size: number | null;
  note: string | null;
}

interface AttachableQueryResponse {
  QueryResponse?: {
    Attachable?: Array<Record<string, unknown>>;
    totalCount?: number;
  };
}

function mapAttachable(raw: Record<string, unknown>): AttachmentMetadata {
  return {
    id: String(raw.Id ?? ""),
    file_name: typeof raw.FileName === "string" ? raw.FileName : null,
    content_type: typeof raw.ContentType === "string" ? raw.ContentType : null,
    size: typeof raw.Size === "number" ? raw.Size : null,
    note: typeof raw.Note === "string" ? raw.Note : null,
  };
}

function escapeQbql(value: string): string {
  return value.replace(/'/g, "''").replace(/[\r\n\0]/g, "");
}

export async function handleListAttachments(
  input: ListAttachmentsInput,
  qbo: QboClient,
): Promise<Result<AttachmentMetadata[], QboError>> {
  const entityId = escapeQbql(input.entity_id);
  const qbql =
    `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = '${input.entity_type}'` +
    ` AND AttachableRef.EntityRef.value = '${entityId}'`;
  const result = await qbo.query<AttachableQueryResponse>(qbql);
  if (!result.ok) return result;
  const attachables = result.value.QueryResponse?.Attachable ?? [];
  return { ok: true, value: attachables.map(mapAttachable) };
}

export const listAttachmentsTool: ToolDefinition<ListAttachmentsInput> = {
  name: "list_attachments",
  description:
    "List attachments linked to a QuickBooks entity (e.g. a Bill or Invoice). Returns metadata " +
    "for each attachment: id, file_name, content_type, size, and optional note. " +
    "Use get_attachment with the returned id to download a specific file.",
  schema: listAttachmentsSchema,
  handler: async (input, deps) => handleListAttachments(input, deps.qbo),
};
