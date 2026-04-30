import { z } from "zod";
import { type PaginatedResult, paginate } from "../pagination/index.js";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const listVendorsSchema = {
  active: z
    .boolean()
    .optional()
    .describe(
      "Filter by active status. true = active vendors only; false = inactive only. " +
        "Omit to use QBO default (active only).",
    ),
  name_contains: z
    .string()
    .optional()
    .describe("Filter to vendors whose DisplayName contains this substring (case-insensitive LIKE match)."),
  balance_gt: z
    .number()
    .optional()
    .describe("Filter to vendors with Balance greater than this value (open AP)."),
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

export type ListVendorsInput = {
  [K in keyof typeof listVendorsSchema]?: z.infer<(typeof listVendorsSchema)[K]>;
};

interface VendorQueryResponse {
  QueryResponse?: {
    Vendor?: Record<string, unknown>[];
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

export function buildWhereClause(input: ListVendorsInput): string {
  const conditions: string[] = [];

  if (input.active === true) conditions.push("Active = true");
  else if (input.active === false) conditions.push("Active = false");

  if (input.name_contains) {
    conditions.push(`DisplayName LIKE '%${escapeQbql(input.name_contains)}%'`);
  }
  if (input.balance_gt !== undefined) {
    conditions.push(`Balance > '${input.balance_gt}'`);
  }

  return conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
}

function escapeQbql(value: string): string {
  return value.replace(/'/g, "''").replace(/[\r\n\0]/g, "");
}

export async function handleListVendors(
  input: ListVendorsInput,
  qbo: QboClient,
): Promise<Result<PaginatedResult<Record<string, unknown>>, QboError>> {
  const where = buildWhereClause(input);

  return paginate(input, {
    fetchPage: async (startPosition, maxResults) => {
      const qbql = `SELECT * FROM Vendor${where} STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const result = await qbo.query<VendorQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.Vendor ?? [] };
    },
    fetchCount: async () => {
      const qbql = `SELECT COUNT(*) FROM Vendor${where}`;
      const result = await qbo.query<VendorQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.totalCount ?? 0 };
    },
  });
}

export const listVendorsTool: ToolDefinition<ListVendorsInput> = {
  name: "list_vendors",
  description:
    "List QuickBooks vendors, optionally filtered by active status, name, or balance. " +
    "Returns up to 100 vendors per call by default. " +
    "Use cursor for pagination, fetch_all for full scans (capped at 5000), or count_only for cheap totals. " +
    "Each item is the QBO Vendor entity verbatim (Id, DisplayName, Balance, etc.).",
  schema: listVendorsSchema,
  handler: async (input, deps) => handleListVendors(input, deps.qbo),
};
