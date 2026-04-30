import { z } from "zod";
import { type PaginatedResult, paginate } from "../pagination/index.js";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const listCustomersSchema = {
  active: z
    .boolean()
    .optional()
    .describe(
      "Filter by active status. true = active customers only; false = inactive only. " +
        "Omit to use QBO default (active only).",
    ),
  name_contains: z
    .string()
    .optional()
    .describe("Filter to customers whose DisplayName contains this substring (case-insensitive LIKE match)."),
  email_contains: z
    .string()
    .optional()
    .describe("Filter to customers whose PrimaryEmailAddr contains this substring (case-insensitive LIKE match)."),
  balance_gt: z
    .number()
    .optional()
    .describe("Filter to customers with Balance greater than this value (open AR)."),
  balance_lt: z
    .number()
    .optional()
    .describe("Filter to customers with Balance less than this value."),
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

export type ListCustomersInput = {
  [K in keyof typeof listCustomersSchema]?: z.infer<(typeof listCustomersSchema)[K]>;
};

interface CustomerQueryResponse {
  QueryResponse?: {
    Customer?: Record<string, unknown>[];
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

export function buildWhereClause(input: ListCustomersInput): string {
  const conditions: string[] = [];

  if (input.active === true) conditions.push("Active = true");
  else if (input.active === false) conditions.push("Active = false");

  if (input.name_contains) {
    conditions.push(`DisplayName LIKE '%${escapeQbql(input.name_contains)}%'`);
  }
  if (input.email_contains) {
    conditions.push(`PrimaryEmailAddr LIKE '%${escapeQbql(input.email_contains)}%'`);
  }
  if (input.balance_gt !== undefined) {
    conditions.push(`Balance > '${input.balance_gt}'`);
  }
  if (input.balance_lt !== undefined) {
    conditions.push(`Balance < '${input.balance_lt}'`);
  }

  return conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
}

function escapeQbql(value: string): string {
  return value.replace(/'/g, "''").replace(/[\r\n\0]/g, "");
}

export async function handleListCustomers(
  input: ListCustomersInput,
  qbo: QboClient,
): Promise<Result<PaginatedResult<Record<string, unknown>>, QboError>> {
  const where = buildWhereClause(input);

  return paginate(input, {
    fetchPage: async (startPosition, maxResults) => {
      const qbql = `SELECT * FROM Customer${where} STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const result = await qbo.query<CustomerQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.Customer ?? [] };
    },
    fetchCount: async () => {
      const qbql = `SELECT COUNT(*) FROM Customer${where}`;
      const result = await qbo.query<CustomerQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.totalCount ?? 0 };
    },
  });
}

export const listCustomersTool: ToolDefinition<ListCustomersInput> = {
  name: "list_customers",
  description:
    "List QuickBooks customers, optionally filtered by active status, name, email, or balance. " +
    "Returns up to 100 customers per call by default. " +
    "Use cursor for pagination, fetch_all for full scans (capped at 5000), or count_only for cheap totals. " +
    "Each item is the QBO Customer entity verbatim (Id, DisplayName, PrimaryEmailAddr, Balance, etc.).",
  schema: listCustomersSchema,
  handler: async (input, deps) => handleListCustomers(input, deps.qbo),
};
