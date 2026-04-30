import { describe, expect, it } from "vitest";
import { buildWhereClause } from "../list_bills.js";

describe("buildWhereClause for list_bills", () => {
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

  it("vendor_id maps to VendorRef equality", () => {
    expect(buildWhereClause({ vendor_id: "42" })).toBe(" WHERE VendorRef = '42'");
  });

  it("due_before and due_after produce DueDate range", () => {
    const where = buildWhereClause({ due_after: "2026-01-01", due_before: "2026-06-30" });
    expect(where).toContain("DueDate <= '2026-06-30'");
    expect(where).toContain("DueDate >= '2026-01-01'");
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
      vendor_id: "42",
    });
    expect(where).toBe(
      " WHERE Balance > '0' AND TxnDate >= '2026-01-01' AND VendorRef = '42'",
    );
  });

  it("escapes single quotes in string values", () => {
    expect(buildWhereClause({ vendor_id: "O'Brien" })).toBe(
      " WHERE VendorRef = 'O''Brien'",
    );
  });
});
