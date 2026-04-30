import { describe, expect, it } from "vitest";
import { buildWhereClause } from "../list_vendors.js";

describe("buildWhereClause for list_vendors", () => {
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
    expect(buildWhereClause({ name_contains: "Supply" })).toBe(
      " WHERE DisplayName LIKE '%Supply%'",
    );
  });

  it("balance_gt produces Balance > condition", () => {
    expect(buildWhereClause({ balance_gt: 50 })).toBe(" WHERE Balance > '50'");
  });

  it("ANDs multiple conditions together", () => {
    const where = buildWhereClause({
      active: false,
      name_contains: "Corp",
      balance_gt: 100,
    });
    expect(where).toBe(
      " WHERE Active = false AND DisplayName LIKE '%Corp%' AND Balance > '100'",
    );
  });

  it("escapes single quotes in string values", () => {
    expect(buildWhereClause({ name_contains: "Bob's" })).toBe(
      " WHERE DisplayName LIKE '%Bob''s%'",
    );
  });
});
