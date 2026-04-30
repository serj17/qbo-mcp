import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getApAgingSummarySchema = {
  as_of_date: z
    .string()
    .optional()
    .describe("Point-in-time date for the aging report (YYYY-MM-DD). Defaults to today."),
  vendor_id: z
    .string()
    .optional()
    .describe("Filter to a single vendor by QBO vendor ID."),
};

export type GetApAgingSummaryInput = {
  as_of_date?: string;
  vendor_id?: string;
};

export async function handleGetApAgingSummary(
  input: GetApAgingSummaryInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  const params: Record<string, string> = {};
  if (input.as_of_date) {
    params.report_date = input.as_of_date;
  }
  if (input.vendor_id) {
    params.vendor = input.vendor_id;
  }

  return qbo.report("AgedPayableDetail", params);
}

export const getApAgingSummaryTool: ToolDefinition<GetApAgingSummaryInput> = {
  name: "get_ap_aging_summary",
  description:
    "Fetch an Accounts Payable aging report from QuickBooks as of a specific date. " +
    "Returns the full QBO report JSON with Header, Columns, and Rows showing outstanding " +
    "payables grouped by aging bucket (Current, 1-30, 31-60, 61-90, 91+). " +
    "Defaults to today when as_of_date is omitted.",
  schema: getApAgingSummarySchema,
  handler: async (input, deps) => handleGetApAgingSummary(input as GetApAgingSummaryInput, deps.qbo),
};
