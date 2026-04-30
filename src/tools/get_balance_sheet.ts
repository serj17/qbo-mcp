import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getBalanceSheetSchema = {
  as_of_date: z
    .string()
    .describe("Point-in-time date for the balance sheet (YYYY-MM-DD). Shows balances as of this date."),
  accounting_method: z
    .enum(["Cash", "Accrual"])
    .optional()
    .describe(
      "Accounting method. 'Cash' recognizes revenue/expenses when cash changes hands; " +
        "'Accrual' recognizes when earned/incurred. Defaults to Accrual (QBO UI default).",
    ),
};

export type GetBalanceSheetInput = {
  as_of_date: string;
  accounting_method?: "Cash" | "Accrual";
};

export async function handleGetBalanceSheet(
  input: GetBalanceSheetInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  const params: Record<string, string> = {
    date_macro: "",
    start_date: input.as_of_date,
    end_date: input.as_of_date,
    accounting_method: input.accounting_method ?? "Accrual",
  };

  return qbo.report("BalanceSheet", params);
}

export const getBalanceSheetTool: ToolDefinition<GetBalanceSheetInput> = {
  name: "get_balance_sheet",
  description:
    "Fetch a Balance Sheet report from QuickBooks as of a specific date. " +
    "Returns the full QBO report JSON with Header, Columns, and Rows. " +
    "The Rows block contains nested sections (Assets, Liabilities, Equity) " +
    "with summary totals at each level.",
  schema: getBalanceSheetSchema,
  handler: async (input, deps) => handleGetBalanceSheet(input as GetBalanceSheetInput, deps.qbo),
};
