import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getProfitAndLossSchema = {
  start_date: z
    .string()
    .describe("Start date for the report period (YYYY-MM-DD)."),
  end_date: z
    .string()
    .describe("End date for the report period (YYYY-MM-DD)."),
  accounting_method: z
    .enum(["Cash", "Accrual"])
    .optional()
    .describe(
      "Accounting method. 'Cash' recognizes revenue/expenses when cash changes hands; " +
        "'Accrual' recognizes when earned/incurred. Defaults to Accrual (QBO UI default).",
    ),
  summarize_by: z
    .enum(["Month", "Quarter", "Year", "Total"])
    .optional()
    .describe(
      "How to break down the columns. 'Total' gives a single column for the whole period; " +
        "'Month'/'Quarter'/'Year' add one column per sub-period. Defaults to Total.",
    ),
};

export type GetProfitAndLossInput = {
  start_date: string;
  end_date: string;
  accounting_method?: "Cash" | "Accrual";
  summarize_by?: "Month" | "Quarter" | "Year" | "Total";
};

export async function handleGetProfitAndLoss(
  input: GetProfitAndLossInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  const params: Record<string, string> = {
    start_date: input.start_date,
    end_date: input.end_date,
    accounting_method: input.accounting_method ?? "Accrual",
  };
  if (input.summarize_by) {
    params.summarize_column_by = input.summarize_by;
  }

  return qbo.report("ProfitAndLoss", params);
}

export const getProfitAndLossTool: ToolDefinition<GetProfitAndLossInput> = {
  name: "get_profit_and_loss",
  description:
    "Fetch a Profit & Loss (income statement) report from QuickBooks for a date range. " +
    "Returns the full QBO report JSON with Header, Columns, and Rows. " +
    "The Rows block contains nested sections (Income, Cost of Goods Sold, Expenses, etc.) " +
    "with summary totals. Use summarize_by to break the period into sub-columns.",
  schema: getProfitAndLossSchema,
  handler: async (input, deps) => handleGetProfitAndLoss(input as GetProfitAndLossInput, deps.qbo),
};
