import { z } from "zod";
import { type PaginatedResult, paginate } from "../pagination/index.js";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const listAccountsSchema = {
  active: z
    .boolean()
    .optional()
    .describe(
      "Filter by active status. true = active accounts only; false = inactive only. " +
        "Omit to use QBO default (active only).",
    ),
  account_type: z
    .string()
    .optional()
    .describe(
      "Filter by QBO AccountType. Common values: Bank, Accounts Receivable, Accounts Payable, " +
        "Income, Expense, Cost of Goods Sold, Fixed Asset, Other Current Asset, Other Current Liability, " +
        "Equity, Credit Card, Long Term Liability, Other Income, Other Expense.",
    ),
  account_subtype: z
    .string()
    .optional()
    .describe("Filter by QBO AccountSubType (e.g., Checking, Savings, AccountsReceivable). Values depend on AccountType."),
  name_contains: z
    .string()
    .optional()
    .describe("Filter to accounts whose Name contains this substring (case-insensitive LIKE match)."),
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

export type ListAccountsInput = {
  [K in keyof typeof listAccountsSchema]?: z.infer<(typeof listAccountsSchema)[K]>;
};

interface AccountQueryResponse {
  QueryResponse?: {
    Account?: Record<string, unknown>[];
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

export function buildWhereClause(input: ListAccountsInput): string {
  const conditions: string[] = [];

  if (input.active === true) conditions.push("Active = true");
  else if (input.active === false) conditions.push("Active = false");

  if (input.account_type) {
    conditions.push(`AccountType = '${escapeQbql(input.account_type)}'`);
  }
  if (input.account_subtype) {
    conditions.push(`AccountSubType = '${escapeQbql(input.account_subtype)}'`);
  }
  if (input.name_contains) {
    conditions.push(`Name LIKE '%${escapeQbql(input.name_contains)}%'`);
  }

  return conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
}

function escapeQbql(value: string): string {
  return value.replace(/'/g, "''").replace(/[\r\n\0]/g, "");
}

export async function handleListAccounts(
  input: ListAccountsInput,
  qbo: QboClient,
): Promise<Result<PaginatedResult<Record<string, unknown>>, QboError>> {
  const where = buildWhereClause(input);

  return paginate(input, {
    fetchPage: async (startPosition, maxResults) => {
      const qbql = `SELECT * FROM Account${where} STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const result = await qbo.query<AccountQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.Account ?? [] };
    },
    fetchCount: async () => {
      const qbql = `SELECT COUNT(*) FROM Account${where}`;
      const result = await qbo.query<AccountQueryResponse>(qbql);
      if (!result.ok) return result;
      return { ok: true, value: result.value.QueryResponse?.totalCount ?? 0 };
    },
  });
}

export const listAccountsTool: ToolDefinition<ListAccountsInput> = {
  name: "list_accounts",
  description:
    "List QuickBooks chart-of-accounts entries, optionally filtered by active status, type, subtype, or name. " +
    "Returns up to 100 accounts per call by default. " +
    "Use cursor for pagination, fetch_all for full scans (capped at 5000), or count_only for cheap totals. " +
    "Each item is the QBO Account entity verbatim (Id, Name, AccountType, AccountSubType, CurrentBalance, etc.).",
  schema: listAccountsSchema,
  handler: async (input, deps) => handleListAccounts(input, deps.qbo),
};
