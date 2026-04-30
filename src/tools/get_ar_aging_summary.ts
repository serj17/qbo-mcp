import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getArAgingSummarySchema = {
  as_of_date: z
    .string()
    .optional()
    .describe("Point-in-time date for the aging report (YYYY-MM-DD). Defaults to today."),
  customer_id: z
    .string()
    .optional()
    .describe("Filter to a single customer by QBO customer ID."),
};

export type GetArAgingSummaryInput = {
  as_of_date?: string;
  customer_id?: string;
};

export async function handleGetArAgingSummary(
  input: GetArAgingSummaryInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  const params: Record<string, string> = {};
  if (input.as_of_date) {
    params.report_date = input.as_of_date;
  }
  if (input.customer_id) {
    params.customer = input.customer_id;
  }

  return qbo.report("AgedReceivableDetail", params);
}

export const getArAgingSummaryTool: ToolDefinition<GetArAgingSummaryInput> = {
  name: "get_ar_aging_summary",
  description:
    "Fetch an Accounts Receivable aging report from QuickBooks as of a specific date. " +
    "Returns the full QBO report JSON with Header, Columns, and Rows showing outstanding " +
    "receivables grouped by aging bucket (Current, 1-30, 31-60, 61-90, 91+). " +
    "Defaults to today when as_of_date is omitted.",
  schema: getArAgingSummarySchema,
  handler: async (input, deps) => handleGetArAgingSummary(input as GetArAgingSummaryInput, deps.qbo),
};
