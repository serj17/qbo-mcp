import { z } from "zod";
import {
  type PaginatedResult,
  paginate,
} from "../pagination/index.js";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

/**
 * Filter shape for list_invoices. Each field is independently optional;
 * combinations narrow the result set with AND semantics.
 *
 * Field descriptions are written for Claude — they explain what the value
 * does, what the format looks like, and when to use it. The MCP SDK passes
 * these descriptions to the model's tool-selection prompt.
 */
export const listInvoicesSchema = {
  status: z
    .enum(["paid", "unpaid", "all"])
    .optional()
    .describe("Filter by payment status. 'paid' = Balance = 0; 'unpaid' = Balance > 0; 'all' (default) = no filter."),
  date_range_start: z
    .string()
    .optional()
    .describe("Filter to invoices with TxnDate on or after this YYYY-MM-DD date."),
  date_range_end: z
    .string()
    .optional()
    .describe("Filter to invoices with TxnDate on or before this YYYY-MM-DD date."),
  customer_id: z
    .string()
    .optional()
    .describe("Filter to invoices for a specific customer (their QBO Customer.Id)."),
  min_amount: z
    .number()
    .optional()
    .describe("Filter to invoices with TotalAmt >= this value."),
  max_amount: z
    .number()
    .optional()
    .describe("Filter to invoices with TotalAmt <= this value."),
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

export type ListInvoicesInput = {
  [K in keyof typeof listInvoicesSchema]?: z.infer<(typeof listInvoicesSchema)[K]>;
};

export interface InvoiceSummary {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: { value: string; name?: string };
  [key: string]: unknown;
}

interface InvoiceQueryResponse {
  QueryResponse?: {
    Invoice?: InvoiceSummary[];
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

/**
 * Build the WHERE clause portion shared between the data and count queries.
 * Returns either an empty string or " WHERE <conditions>" with proper QBQL
 * quoting for string and date literals.
 */
export function buildWhereClause(input: ListInvoicesInput): string {
  const conditions: string[] = [];

  if (input.status === "paid") conditions.push("Balance = '0'");
  else if (input.status === "unpaid") conditions.push("Balance > '0'");

  if (input.date_range_start) {
    conditions.push(`TxnDate >= '${escapeQbql(input.date_range_start)}'`);
  }
  if (input.date_range_end) {
    conditions.push(`TxnDate <= '${escapeQbql(input.date_range_end)}'`);
  }
  if (input.customer_id) {
    conditions.push(`CustomerRef = '${escapeQbql(input.customer_id)}'`);
  }
  if (input.min_amount !== undefined) {
    conditions.push(`TotalAmt >= '${input.min_amount}'`);
  }
  if (input.max_amount !== undefined) {
    conditions.push(`TotalAmt <= '${input.max_amount}'`);
  }

  return conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
}

/**
 * QBQL uses single-quoted string literals; escape embedded single quotes by
 * doubling. Anything stranger (newlines, NULs) we strip — the user shouldn't
 * be passing them into a date or customer id, and silently passing them
 * through risks a query parse error.
 */
function escapeQbql(value: string): string {
  return value.replace(/'/g, "''").replace(/[\r\n\0]/g, "");
}

/**
 * The handler used by the tool-registry. Pure in the dependency-injection
 * sense: takes a QboClient and returns Result. The tool-registry wraps it
 * for logging + MCP error mapping.
 */
export async function handleListInvoices(
  input: ListInvoicesInput,
  qbo: QboClient,
): Promise<Result<PaginatedResult<InvoiceSummary>, QboError>> {
  const where = buildWhereClause(input);

  return paginate(input, {
    fetchPage: async (startPosition, maxResults) => {
      const qbql = `SELECT * FROM Invoice${where} ORDER BY TxnDate DESC STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const result = await qbo.query<InvoiceQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.Invoice ?? [] };
    },
    fetchCount: async () => {
      const qbql = `SELECT COUNT(*) FROM Invoice${where}`;
      const result = await qbo.query<InvoiceQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.totalCount ?? 0 };
    },
  });
}

export const listInvoicesTool: ToolDefinition<ListInvoicesInput> = {
  name: "list_invoices",
  description:
    "List QuickBooks invoices, optionally filtered by status, date range, customer, or amount. " +
    "Returns up to 100 invoices per call by default, sorted newest first by TxnDate. " +
    "Use cursor for pagination, fetch_all for full scans (capped at 5000), or count_only for cheap totals. " +
    "Each item is the QBO Invoice entity verbatim (Id, DocNumber, TxnDate, TotalAmt, Balance, CustomerRef, Line items, etc.).",
  schema: listInvoicesSchema,
  handler: async (input, deps) => handleListInvoices(input, deps.qbo),
};
