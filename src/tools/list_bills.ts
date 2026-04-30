import { z } from "zod";
import { type PaginatedResult, paginate } from "../pagination/index.js";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const listBillsSchema = {
  status: z
    .enum(["paid", "unpaid", "all"])
    .optional()
    .describe("Filter by payment status. 'paid' = Balance = 0; 'unpaid' = Balance > 0; 'all' (default) = no filter."),
  date_range_start: z
    .string()
    .optional()
    .describe("Filter to bills with TxnDate on or after this YYYY-MM-DD date."),
  date_range_end: z
    .string()
    .optional()
    .describe("Filter to bills with TxnDate on or before this YYYY-MM-DD date."),
  vendor_id: z
    .string()
    .optional()
    .describe("Filter to bills for a specific vendor (their QBO Vendor.Id)."),
  due_before: z
    .string()
    .optional()
    .describe("Filter to bills with DueDate on or before this YYYY-MM-DD date."),
  due_after: z
    .string()
    .optional()
    .describe("Filter to bills with DueDate on or after this YYYY-MM-DD date."),
  min_amount: z
    .number()
    .optional()
    .describe("Filter to bills with TotalAmt >= this value."),
  max_amount: z
    .number()
    .optional()
    .describe("Filter to bills with TotalAmt <= this value."),
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Items per page. Default 100, max 1000 (QBO's per-request cap)."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque cursor from a prior page_info.next_cursor. Treat as a magic string; do not synthesize one."),
  fetch_all: z
    .boolean()
    .optional()
    .describe("Auto-paginate up to 5000 records. Use for anomaly scans where you need the whole set."),
  count_only: z
    .boolean()
    .optional()
    .describe("Return only { page_info: { total_count: N } }. Use to scope before pulling data."),
};

export type ListBillsInput = {
  [K in keyof typeof listBillsSchema]?: z.infer<(typeof listBillsSchema)[K]>;
};

interface BillQueryResponse {
  QueryResponse?: {
    Bill?: Record<string, unknown>[];
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

export function buildWhereClause(input: ListBillsInput): string {
  const conditions: string[] = [];

  if (input.status === "paid") conditions.push("Balance = '0'");
  else if (input.status === "unpaid") conditions.push("Balance > '0'");

  if (input.date_range_start) {
    conditions.push(`TxnDate >= '${escapeQbql(input.date_range_start)}'`);
  }
  if (input.date_range_end) {
    conditions.push(`TxnDate <= '${escapeQbql(input.date_range_end)}'`);
  }
  if (input.vendor_id) {
    conditions.push(`VendorRef = '${escapeQbql(input.vendor_id)}'`);
  }
  if (input.due_before) {
    conditions.push(`DueDate <= '${escapeQbql(input.due_before)}'`);
  }
  if (input.due_after) {
    conditions.push(`DueDate >= '${escapeQbql(input.due_after)}'`);
  }
  if (input.min_amount !== undefined) {
    conditions.push(`TotalAmt >= '${input.min_amount}'`);
  }
  if (input.max_amount !== undefined) {
    conditions.push(`TotalAmt <= '${input.max_amount}'`);
  }

  return conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
}

function escapeQbql(value: string): string {
  return value.replace(/'/g, "''").replace(/[\r\n\0]/g, "");
}

export async function handleListBills(
  input: ListBillsInput,
  qbo: QboClient,
): Promise<Result<PaginatedResult<Record<string, unknown>>, QboError>> {
  const where = buildWhereClause(input);

  return paginate(input, {
    fetchPage: async (startPosition, maxResults) => {
      const qbql = `SELECT * FROM Bill${where} ORDER BY TxnDate DESC STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const result = await qbo.query<BillQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.Bill ?? [] };
    },
    fetchCount: async () => {
      const qbql = `SELECT COUNT(*) FROM Bill${where}`;
      const result = await qbo.query<BillQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.totalCount ?? 0 };
    },
  });
}

export const listBillsTool: ToolDefinition<ListBillsInput> = {
  name: "list_bills",
  description:
    "List QuickBooks bills, optionally filtered by status, date range, vendor, due date, or amount. " +
    "Returns up to 100 bills per call by default, sorted newest first by TxnDate. " +
    "Use cursor for pagination, fetch_all for full scans (capped at 5000), or count_only for cheap totals. " +
    "Each item is the QBO Bill entity verbatim (Id, TxnDate, DueDate, TotalAmt, Balance, VendorRef, Line items, etc.).",
  schema: listBillsSchema,
  handler: async (input, deps) => handleListBills(input, deps.qbo),
};
