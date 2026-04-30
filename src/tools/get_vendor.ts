import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getVendorSchema = {
  id: z
    .string()
    .describe("The QBO entity ID of the vendor (Vendor.Id), not the DisplayName."),
};

export type GetVendorInput = { id: string };

interface VendorReadResponse {
  Vendor?: Record<string, unknown>;
}

export async function handleGetVendor(
  input: GetVendorInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  const result = await qbo.read<VendorReadResponse>("vendor", input.id);
  if (!result.ok) return result;
  const entity = result.value.Vendor;
  if (!entity) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Vendor with Id '${input.id}' not found.`,
        retryable: false,
      },
    };
  }
  return { ok: true, value: entity };
}

export const getVendorTool: ToolDefinition<GetVendorInput> = {
  name: "get_vendor",
  description:
    "Fetch a single QuickBooks vendor by its QBO entity ID. Returns the full nested Vendor " +
    "object (DisplayName, billing address, email, phone, tax ID, balance, 1099 status, etc.). " +
    "Use list_vendors first to find the Id, then call this for the complete record.",
  schema: getVendorSchema,
  handler: async (input, deps) => handleGetVendor(input, deps.qbo),
};
