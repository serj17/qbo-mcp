import { describe, expect, it } from "vitest";
import { buildWhereClause } from "../list_accounts.js";

describe("buildWhereClause for list_accounts", () => {
  it("returns empty string when no filters supplied", () => {
    expect(buildWhereClause({})).toBe("");
  });

  it("active=true maps to Active = true", () => {
    expect(buildWhereClause({ active: true })).toBe(" WHERE Active = true");
  });

  it("active=false maps to Active = false", () => {
    expect(buildWhereClause({ active: false })).toBe(" WHERE Active = false");
  });

  it("account_type produces equality clause", () => {
    expect(buildWhereClause({ account_type: "Expense" })).toBe(
      " WHERE AccountType = 'Expense'",
    );
  });

  it("account_subtype produces equality clause", () => {
    expect(buildWhereClause({ account_subtype: "Checking" })).toBe(
      " WHERE AccountSubType = 'Checking'",
    );
  });

  it("name_contains produces LIKE clause on Name", () => {
    expect(buildWhereClause({ name_contains: "Office" })).toBe(
      " WHERE Name LIKE '%Office%'",
    );
  });

  it("ANDs multiple conditions together", () => {
    const where = buildWhereClause({
      active: true,
      account_type: "Bank",
      name_contains: "Cash",
    });
    expect(where).toBe(
      " WHERE Active = true AND AccountType = 'Bank' AND Name LIKE '%Cash%'",
    );
  });

  it("escapes single quotes in string values", () => {
    expect(buildWhereClause({ name_contains: "Owner's" })).toBe(
      " WHERE Name LIKE '%Owner''s%'",
    );
  });
});
