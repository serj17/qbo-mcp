import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const getCustomerSchema = {
  id: z
    .string()
    .describe("The QBO entity ID of the customer (Customer.Id), not the DisplayName."),
};

export type GetCustomerInput = { id: string };

interface CustomerReadResponse {
  Customer?: Record<string, unknown>;
}

export async function handleGetCustomer(
  input: GetCustomerInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  const result = await qbo.read<CustomerReadResponse>("customer", input.id);
  if (!result.ok) return result;
  const entity = result.value.Customer;
  if (!entity) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Customer with Id '${input.id}' not found.`,
        retryable: false,
      },
    };
  }
  return { ok: true, value: entity };
}

export const getCustomerTool: ToolDefinition<GetCustomerInput> = {
  name: "get_customer",
  description:
    "Fetch a single QuickBooks customer by its QBO entity ID. Returns the full nested Customer " +
    "object (DisplayName, billing/shipping addresses, email, phone, balance, notes, etc.). " +
    "Use list_customers first to find the Id, then call this for the complete record.",
  schema: getCustomerSchema,
  handler: async (input, deps) => handleGetCustomer(input, deps.qbo),
};
