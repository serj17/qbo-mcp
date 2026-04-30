import { describe, expect, it } from "vitest";

/**
 * list_transactions uses the QBO TransactionList report rather than QBQL,
 * so there's no buildWhereClause to unit-test. Instead we test the report
 * row parsing and client-side amount filtering via the exported handler
 * with a fake QboClient.
 */

import type { QboClient, QboError, Result } from "../../qbo-client/index.js";
import { handleListTransactions } from "../list_transactions.js";

function fakeQbo(reportResponse: unknown): QboClient {
  return {
    report: async () => ({ ok: true, value: reportResponse }) as Result<unknown, QboError>,
  } as unknown as QboClient;
}

const sampleReport = {
  Header: { ReportName: "TransactionList" },
  Columns: {
    Column: [
      { ColTitle: "Date", ColType: "tx_date" },
      { ColTitle: "Transaction Type", ColType: "txn_type" },
      { ColTitle: "No.", ColType: "doc_num" },
      { ColTitle: "Name", ColType: "name" },
      { ColTitle: "Account", ColType: "account_name" },
      { ColTitle: "Amount", ColType: "subt_nat_amount" },
      { ColTitle: "Memo", ColType: "memo" },
    ],
  },
  Rows: {
    Row: [
      {
        type: "Data",
        ColData: [
          { value: "2026-01-15" },
          { value: "Invoice", id: "101" },
          { value: "1001" },
          { value: "Customer A", id: "201" },
          { value: "Accounts Receivable", id: "301" },
          { value: "500.00" },
          { value: "Services" },
        ],
      },
      {
        type: "Data",
        ColData: [
          { value: "2026-01-20" },
          { value: "Bill", id: "102" },
          { value: "2001" },
          { value: "Vendor B", id: "202" },
          { value: "Accounts Payable", id: "302" },
          { value: "-250.00" },
          { value: "Supplies" },
        ],
      },
      {
        type: "Data",
        ColData: [
          { value: "2026-02-01" },
          { value: "Payment", id: "103" },
          { value: "3001" },
          { value: "Customer A", id: "201" },
          { value: "Accounts Receivable", id: "301" },
          { value: "50.00" },
          { value: "Partial payment" },
        ],
      },
    ],
  },
};

describe("handleListTransactions", () => {
  it("parses report rows into structured objects", async () => {
    const qbo = fakeQbo(sampleReport);
    const result = await handleListTransactions(
      { date_range_start: "2026-01-01", date_range_end: "2026-12-31" },
      qbo,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(3);
    expect(result.value.items[0]).toEqual({
      tx_date: "2026-01-15",
      txn_type: "Invoice",
      txn_type_id: "101",
      doc_num: "1001",
      name: "Customer A",
      name_id: "201",
      account_name: "Accounts Receivable",
      account_name_id: "301",
      subt_nat_amount: "500.00",
      memo: "Services",
    });
  });

  it("includes entity IDs as _id suffixed keys", async () => {
    const qbo = fakeQbo(sampleReport);
    const result = await handleListTransactions(
      { date_range_start: "2026-01-01", date_range_end: "2026-12-31" },
      qbo,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items[0]).toHaveProperty("txn_type_id", "101");
    expect(result.value.items[0]).toHaveProperty("name_id", "201");
    expect(result.value.items[0]).toHaveProperty("account_name_id", "301");
  });

  it("applies min_amount filter (absolute value)", async () => {
    const qbo = fakeQbo(sampleReport);
    const result = await handleListTransactions(
      { date_range_start: "2026-01-01", date_range_end: "2026-12-31", min_amount: 100 },
      qbo,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(2);
    expect(result.value.items.map((i) => i.subt_nat_amount)).toEqual(["500.00", "-250.00"]);
  });

  it("applies max_amount filter (absolute value)", async () => {
    const qbo = fakeQbo(sampleReport);
    const result = await handleListTransactions(
      { date_range_start: "2026-01-01", date_range_end: "2026-12-31", max_amount: 100 },
      qbo,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0].subt_nat_amount).toBe("50.00");
  });

  it("count_only returns total without items", async () => {
    const qbo = fakeQbo(sampleReport);
    const result = await handleListTransactions(
      { date_range_start: "2026-01-01", date_range_end: "2026-12-31", count_only: true },
      qbo,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toEqual([]);
    expect(result.value.page_info.total_count).toBe(3);
    expect(result.value.page_info.returned_count).toBe(0);
  });

  it("paginates with limit", async () => {
    const qbo = fakeQbo(sampleReport);
    const result = await handleListTransactions(
      { date_range_start: "2026-01-01", date_range_end: "2026-12-31", limit: 2 },
      qbo,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(2);
    expect(result.value.page_info.returned_count).toBe(2);
    expect(result.value.page_info.has_more).toBe(true);
    expect(result.value.page_info.next_cursor).toBeTruthy();
    expect(result.value.page_info.total_count).toBe(3);
  });

  it("paginates with cursor", async () => {
    const qbo = fakeQbo(sampleReport);
    const first = await handleListTransactions(
      { date_range_start: "2026-01-01", date_range_end: "2026-12-31", limit: 2 },
      qbo,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await handleListTransactions(
      {
        date_range_start: "2026-01-01",
        date_range_end: "2026-12-31",
        limit: 2,
        cursor: first.value.page_info.next_cursor!,
      },
      qbo,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.items).toHaveLength(1);
    expect(second.value.page_info.has_more).toBe(false);
    expect(second.value.page_info.total_count).toBeUndefined();
  });

  it("handles nested section rows in report", async () => {
    const nestedReport = {
      ...sampleReport,
      Rows: {
        Row: [
          {
            type: "Section",
            Header: { ColData: [{ value: "Section Header" }] },
            Rows: {
              Row: [sampleReport.Rows.Row[0]],
            },
          },
          sampleReport.Rows.Row[1],
        ],
      },
    };

    const qbo = fakeQbo(nestedReport);
    const result = await handleListTransactions(
      { date_range_start: "2026-01-01", date_range_end: "2026-12-31" },
      qbo,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(2);
  });

  it("handles empty report", async () => {
    const emptyReport = {
      Header: { ReportName: "TransactionList" },
      Columns: { Column: [] },
      Rows: { Row: [] },
    };

    const qbo = fakeQbo(emptyReport);
    const result = await handleListTransactions(
      { date_range_start: "2026-01-01", date_range_end: "2026-12-31" },
      qbo,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toEqual([]);
    expect(result.value.page_info.total_count).toBe(0);
  });
});
