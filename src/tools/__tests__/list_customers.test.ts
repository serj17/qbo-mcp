import { describe, expect, it } from "vitest";
import { buildWhereClause } from "../list_customers.js";

describe("buildWhereClause for list_customers", () => {
  it("returns empty string when no filters supplied", () => {
    expect(buildWhereClause({})).toBe("");
  });

  it("active=true maps to Active = true", () => {
    expect(buildWhereClause({ active: true })).toBe(" WHERE Active = true");
  });

  it("active=false maps to Active = false", () => {
    expect(buildWhereClause({ active: false })).toBe(" WHERE Active = false");
  });

  it("name_contains produces LIKE clause on DisplayName", () => {
    expect(buildWhereClause({ name_contains: "Smith" })).toBe(
      " WHERE DisplayName LIKE '%Smith%'",
    );
  });

  it("email_contains produces LIKE clause on PrimaryEmailAddr", () => {
    expect(buildWhereClause({ email_contains: "gmail" })).toBe(
      " WHERE PrimaryEmailAddr LIKE '%gmail%'",
    );
  });

  it("balance_gt and balance_lt produce range conditions", () => {
    const where = buildWhereClause({ balance_gt: 100, balance_lt: 500 });
    expect(where).toContain("Balance > '100'");
    expect(where).toContain("Balance < '500'");
  });

  it("ANDs multiple conditions together", () => {
    const where = buildWhereClause({
      active: true,
      name_contains: "Acme",
      balance_gt: 0,
    });
    expect(where).toBe(
      " WHERE Active = true AND DisplayName LIKE '%Acme%' AND Balance > '0'",
    );
  });

  it("escapes single quotes in string values", () => {
    expect(buildWhereClause({ name_contains: "O'Brien" })).toBe(
      " WHERE DisplayName LIKE '%O''Brien%'",
    );
  });

  it("strips newlines and NULs from string values", () => {
    expect(buildWhereClause({ name_contains: "abc\ndef\0ghi" })).toBe(
      " WHERE DisplayName LIKE '%abcdefghi%'",
    );
  });
});
