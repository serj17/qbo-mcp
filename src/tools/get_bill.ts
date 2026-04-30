import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getBillSchema = {
  id: z
    .string()
    .describe("The QBO entity ID of the bill (Bill.Id), not the user-facing DocNumber."),
};

export type GetBillInput = { id: string };

interface BillReadResponse {
  Bill?: Record<string, unknown>;
}

export async function handleGetBill(
  input: GetBillInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  const result = await qbo.read<BillReadResponse>("bill", input.id);
  if (!result.ok) return result;
  const entity = result.value.Bill;
  if (!entity) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Bill with Id '${input.id}' not found.`,
        retryable: false,
      },
    };
  }
  return { ok: true, value: entity };
}

export const getBillTool: ToolDefinition<GetBillInput> = {
  name: "get_bill",
  description:
    "Fetch a single QuickBooks bill by its QBO entity ID. Returns the full nested Bill " +
    "object (line items, vendor ref, due date, balance, linked payments, etc.). " +
    "Use list_bills first to find the Id, then call this for the complete record.",
  schema: getBillSchema,
  handler: async (input, deps) => handleGetBill(input, deps.qbo),
};
