import { z } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

export const qboQuerySchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "A QuickBooks Query Language (QBQL) statement. QBQL is a SQL-flavored query language with " +
        "QBO-specific restrictions: no general JOINs (only the documented entity-specific forms), " +
        "no DML, pagination via STARTPOSITION/MAXRESULTS, and SELECT * or specific columns. " +
        "Examples: " +
        "`SELECT * FROM Customer MAXRESULTS 5`, " +
        "`SELECT COUNT(*) FROM Invoice WHERE Balance > '0'`, " +
        "`SELECT Id, DocNumber, TxnDate FROM Invoice WHERE TxnDate >= '2026-01-01' ORDER BY TxnDate DESC`. " +
        "See https://developer.intuit.com/app/developer/qbo/docs/develop/explore-the-quickbooks-online-api/data-queries " +
        "for the full grammar.",
    ),
};

export type QboQueryInput = { query: string };

/**
 * Run any raw QBQL query against the connected QBO realm. Returns the response
 * verbatim so Claude sees the same shape Intuit's docs describe — `QueryResponse`
 * wraps the entity array (e.g. `QueryResponse.Invoice` for an Invoice query) or
 * just `totalCount` for a `SELECT COUNT(*)`.
 *
 * Bad QBQL syntax surfaces as a structured `INVALID_QUERY` error with the QBO
 * fault message preserved so Claude can read the diagnostic ("Encountered ...
 * at line 1, column N") and fix the query.
 */
export async function handleQboQuery(
  input: QboQueryInput,
  qbo: QboClient,
): Promise<Result<unknown, QboError>> {
  return qbo.query<unknown>(input.query);
}

export const qboQueryTool: ToolDefinition<QboQueryInput> = {
  name: "qbo_query",
  description:
    "Escape hatch: run an arbitrary QuickBooks Query Language (QBQL) statement against the connected " +
    "QuickBooks Online company. Use this only when the curated tools (list_*, get_*, reports) don't " +
    "cover what you need. Returns the raw QBO response shape verbatim. Bad syntax comes back as an " +
    "INVALID_QUERY error with the QBO parser message attached so you can fix the query and retry.",
  schema: qboQuerySchema,
  handler: async (input, deps) => handleQboQuery(input, deps.qbo),
};
