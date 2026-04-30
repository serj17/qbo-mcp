import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getGeneralLedgerSchema = {
  start_date: z
    .string()
    .describe("Start date for the ledger period (YYYY-MM-DD)."),
  end_date: z
    .string()
    .describe("End date for the ledger period (YYYY-MM-DD)."),
  account_ids: z
    .array(z.string())
    .optional()
    .describe("Filter to specific account IDs. Omit to include all accounts."),
  summarize_by: z
    .enum(["Month", "Total"])
    .optional()
    .describe(
      "How to summarize the ledger. 'Total' gives one summary for the whole period; " +
        "'Month' breaks it down by calendar month. Defaults to Total.",
    ),
};

export type GetGeneralLedgerInput = {
  start_date: string;
  end_date: string;
  account_ids?: string[];
  summarize_by?: "Month" | "Total";
};

export async function handleGetGeneralLedger(
  input: GetGeneralLedgerInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  const params: Record<string, string> = {
    start_date: input.start_date,
    end_date: input.end_date,
  };
  if (input.account_ids && input.account_ids.length > 0) {
    params.account = input.account_ids.join(",");
  }
  if (input.summarize_by) {
    params.summarize_column_by = input.summarize_by;
  }

  return qbo.report("GeneralLedger", params);
}

export const getGeneralLedgerTool: ToolDefinition<GetGeneralLedgerInput> = {
  name: "get_general_ledger",
  description:
    "Fetch a General Ledger report from QuickBooks for a date range. " +
    "Returns the full QBO report JSON with Header, Columns, and Rows listing every " +
    "transaction that hit the selected accounts during the period. " +
    "Use account_ids to narrow to specific accounts. " +
    "Use summarize_by to break the period into monthly sub-columns.",
  schema: getGeneralLedgerSchema,
  handler: async (input, deps) => handleGetGeneralLedger(input as GetGeneralLedgerInput, deps.qbo),
};
