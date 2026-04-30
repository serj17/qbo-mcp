import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getInvoiceSchema = {
  id: z
    .string()
    .describe("The QBO entity ID of the invoice (Invoice.Id), not the user-facing DocNumber."),
};

export type GetInvoiceInput = { id: string };

interface InvoiceReadResponse {
  Invoice?: Record<string, unknown>;
}

export async function handleGetInvoice(
  input: GetInvoiceInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  const result = await qbo.read<InvoiceReadResponse>("invoice", input.id);
  if (!result.ok) return result;
  const entity = result.value.Invoice;
  if (!entity) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Invoice with Id '${input.id}' not found.`,
        retryable: false,
      },
    };
  }
  return { ok: true, value: entity };
}

export const getInvoiceTool: ToolDefinition<GetInvoiceInput> = {
  name: "get_invoice",
  description:
    "Fetch a single QuickBooks invoice by its QBO entity ID. Returns the full nested Invoice " +
    "object (line items, customer ref, addresses, custom fields, linked transactions, etc.). " +
    "Use list_invoices first to find the Id, then call this for the complete record.",
  schema: getInvoiceSchema,
  handler: async (input, deps) => handleGetInvoice(input, deps.qbo),
};
