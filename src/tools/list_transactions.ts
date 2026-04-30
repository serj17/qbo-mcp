import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  FETCH_ALL_CAP,
  QBO_MAX_PAGE_SIZE,
  type PaginatedResult,
  encodeCursor,
  decodeCursor,
} from "../pagination/index.js";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const listTransactionsSchema = {
  date_range_start: z
    .string()
    .describe("Start date for the transaction list report (YYYY-MM-DD). Required — the QBO TransactionList report needs a date range."),
  date_range_end: z
    .string()
    .describe("End date for the transaction list report (YYYY-MM-DD). Required."),
  account_ids: z
    .array(z.string())
    .optional()
    .describe("Filter to transactions hitting these QBO Account IDs only."),
  txn_types: z
    .array(z.string())
    .optional()
    .describe(
      "Filter to specific transaction types. Common values: Invoice, Bill, Payment, " +
        "CreditCardCharge, Check, Deposit, Transfer, JournalEntry, VendorCredit, CreditMemo.",
    ),
  min_amount: z
    .number()
    .optional()
    .describe("Filter to transactions with absolute amount >= this value (applied client-side after fetching the report)."),
  max_amount: z
    .number()
    .optional()
    .describe("Filter to transactions with absolute amount <= this value (applied client-side after fetching the report)."),
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Items per page. Default 100, max 1000."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque cursor from a prior page_info.next_cursor. Treat as a magic string; do not synthesize one."),
  fetch_all: z
    .boolean()
    .optional()
    .describe("Return all matching transactions up to 5000. Use for anomaly scans."),
  count_only: z
    .boolean()
    .optional()
    .describe("Return only { page_info: { total_count: N } }. Use to scope before pulling data."),
};

export type ListTransactionsInput = {
  date_range_start: string;
  date_range_end: string;
  account_ids?: string[];
  txn_types?: string[];
  min_amount?: number;
  max_amount?: number;
  limit?: number;
  cursor?: string;
  fetch_all?: boolean;
  count_only?: boolean;
};

interface ColData {
  value: string;
  id?: string;
}

interface ReportColumn {
  ColTitle: string;
  ColType: string;
}

interface ReportRow {
  ColData?: ColData[];
  type?: string;
  Header?: { ColData?: ColData[] };
  Rows?: { Row?: ReportRow[] };
  Summary?: { ColData?: ColData[] };
}

interface TransactionListReport {
  Header?: Record<string, unknown>;
  Columns?: { Column?: ReportColumn[] };
  Rows?: { Row?: ReportRow[] };
}

export type TransactionRow = Record<string, unknown>;

function extractDataRows(rows: ReportRow[] | undefined): ColData[][] {
  if (!rows) return [];
  const result: ColData[][] = [];
  for (const row of rows) {
    if (row.type === "Data" && row.ColData) {
      result.push(row.ColData);
    }
    if (row.Rows?.Row) {
      result.push(...extractDataRows(row.Rows.Row));
    }
  }
  return result;
}

function parseReportRows(report: TransactionListReport): TransactionRow[] {
  const columns = report.Columns?.Column ?? [];
  const dataRows = extractDataRows(report.Rows?.Row);

  return dataRows.map((colData) => {
    const obj: TransactionRow = {};
    for (let i = 0; i < columns.length && i < colData.length; i++) {
      const col = columns[i];
      const cell = colData[i];
      obj[col.ColType] = cell.value;
      if (cell.id) {
        obj[`${col.ColType}_id`] = cell.id;
      }
    }
    return obj;
  });
}

function applyAmountFilters(
  rows: TransactionRow[],
  minAmount: number | undefined,
  maxAmount: number | undefined,
): TransactionRow[] {
  if (minAmount === undefined && maxAmount === undefined) return rows;

  return rows.filter((row) => {
    const raw = row.subt_nat_amount ?? row.nat_amount ?? row.amount;
    if (typeof raw !== "string") return true;
    const amt = Math.abs(Number.parseFloat(raw));
    if (!Number.isFinite(amt)) return true;
    if (minAmount !== undefined && amt < minAmount) return false;
    if (maxAmount !== undefined && amt > maxAmount) return false;
    return true;
  });
}

export async function handleListTransactions(
  input: ListTransactionsInput,
  qbo: QboClient,
): Promise<Result<PaginatedResult<TransactionRow>, QboError>> {
  const params: Record<string, string> = {
    start_date: input.date_range_start,
    end_date: input.date_range_end,
    columns: "tx_date,txn_type,doc_num,name,account_name,subt_nat_amount,memo",
  };
  if (input.account_ids?.length) {
    params.account = input.account_ids.join(",");
  }
  if (input.txn_types?.length) {
    params.transaction_type = input.txn_types.join(",");
  }

  const reportResult = await qbo.report<TransactionListReport>("TransactionList", params);
  if (!reportResult.ok) return reportResult;

  let allRows = parseReportRows(reportResult.value);
  allRows = applyAmountFilters(allRows, input.min_amount, input.max_amount);

  const totalCount = allRows.length;
  const limit = clampLimit(input.limit ?? DEFAULT_PAGE_SIZE);

  if (input.count_only) {
    return {
      ok: true,
      value: {
        items: [],
        page_info: {
          total_count: totalCount,
          returned_count: 0,
          has_more: false,
          next_cursor: null,
        },
      },
    };
  }

  if (input.fetch_all) {
    const capped = allRows.slice(0, FETCH_ALL_CAP);
    const hasMore = totalCount > FETCH_ALL_CAP;
    return {
      ok: true,
      value: {
        items: capped,
        page_info: {
          total_count: totalCount,
          returned_count: capped.length,
          has_more: hasMore,
          next_cursor: hasMore ? encodeCursor(FETCH_ALL_CAP + 1) : null,
        },
      },
    };
  }

  const startIndex = input.cursor ? decodeCursor(input.cursor) - 1 : 0;
  const page = allRows.slice(startIndex, startIndex + limit);
  const nextStart = startIndex + page.length;
  const hasMore = nextStart < totalCount;

  return {
    ok: true,
    value: {
      items: page,
      page_info: {
        total_count: input.cursor ? undefined : totalCount,
        returned_count: page.length,
        has_more: hasMore,
        next_cursor: hasMore ? encodeCursor(nextStart + 1) : null,
      },
    },
  };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(limit), QBO_MAX_PAGE_SIZE);
}

export const listTransactionsTool: ToolDefinition<ListTransactionsInput> = {
  name: "list_transactions",
  description:
    "List transactions across all types (invoices, bills, payments, etc.) for a date range. " +
    "Uses the QBO TransactionList report under the hood — requires date_range_start and date_range_end. " +
    "Optionally filter by account IDs, transaction types, or amount range. " +
    "Returns up to 100 rows per call by default. " +
    "Use cursor for pagination, fetch_all for full scans (capped at 5000), or count_only for cheap totals. " +
    "Each item has keys: tx_date, txn_type, doc_num, name, account_name, subt_nat_amount, memo (plus _id suffixed keys for entity IDs).",
  schema: listTransactionsSchema,
  handler: async (input, deps) => handleListTransactions(input as ListTransactionsInput, deps.qbo),
};
