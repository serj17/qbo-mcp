import { describe, expect, it } from "vitest";
import { buildWhereClause } from "../list_invoices.js";

describe("buildWhereClause for list_invoices", () => {
  it("returns empty string when no filters supplied", () => {
    expect(buildWhereClause({})).toBe("");
  });

  it("'all' status produces no Balance clause", () => {
    expect(buildWhereClause({ status: "all" })).toBe("");
  });

  it("'paid' status maps to Balance = 0", () => {
    expect(buildWhereClause({ status: "paid" })).toBe(" WHERE Balance = '0'");
  });

  it("'unpaid' status maps to Balance > 0", () => {
    expect(buildWhereClause({ status: "unpaid" })).toBe(" WHERE Balance > '0'");
  });

  it("date range emits inclusive >= / <= TxnDate clauses", () => {
    const where = buildWhereClause({ date_range_start: "2026-01-01", date_range_end: "2026-03-31" });
    expect(where).toContain("TxnDate >= '2026-01-01'");
    expect(where).toContain("TxnDate <= '2026-03-31'");
  });

  it("customer_id maps to CustomerRef equality", () => {
    expect(buildWhereClause({ customer_id: "42" })).toBe(" WHERE CustomerRef = '42'");
  });

  it("min/max amount map to TotalAmt range", () => {
    const where = buildWhereClause({ min_amount: 100, max_amount: 500 });
    expect(where).toContain("TotalAmt >= '100'");
    expect(where).toContain("TotalAmt <= '500'");
  });

  it("ANDs multiple conditions together", () => {
    const where = buildWhereClause({
      status: "unpaid",
      date_range_start: "2026-01-01",
      customer_id: "42",
    });
    expect(where).toBe(
      " WHERE Balance > '0' AND TxnDate >= '2026-01-01' AND CustomerRef = '42'",
    );
  });

  it("escapes single quotes in string values to prevent QBQL injection", () => {
    expect(buildWhereClause({ customer_id: "O'Brien" })).toBe(
      " WHERE CustomerRef = 'O''Brien'",
    );
  });

  it("strips embedded newlines and NULs from string values", () => {
    expect(buildWhereClause({ customer_id: "abc\ndef\0ghi" })).toBe(
      " WHERE CustomerRef = 'abcdefghi'",
    );
  });
});
