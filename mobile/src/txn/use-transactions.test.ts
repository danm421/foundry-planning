// mobile/src/txn/use-transactions.test.ts
import { describe, it, expect } from "vitest";
import { txnReducer, initialTxnState, type TxnAction } from "./use-transactions";
import type { PortalTransactionDTO } from "@contracts";

const t = (id: string, over: Partial<PortalTransactionDTO> = {}): PortalTransactionDTO => ({
  id, date: "2026-07-01", name: id, merchantName: null, amount: "10.00", pending: false,
  excluded: false, categoryId: null, categoryName: null, categoryColor: null,
  categorizedBy: "plaid", accountId: "a1", accountName: "Checking", accountMask: "1234",
  type: "expense", source: "plaid", reviewed: false, ...over,
});

describe("txnReducer", () => {
  it("appendPage adds rows and updates hasMore/total", () => {
    const s = txnReducer(initialTxnState, { type: "appendPage", page: { transactions: [t("x")], total: 1, hasMore: false } });
    expect(s.rows.map((r) => r.id)).toEqual(["x"]);
    expect(s.hasMore).toBe(false);
    expect(s.total).toBe(1);
  });
  it("optimistically toggles reviewed", () => {
    const base = txnReducer(initialTxnState, { type: "appendPage", page: { transactions: [t("x")], total: 1, hasMore: false } });
    const s = txnReducer(base, { type: "setReviewed", id: "x", reviewed: true });
    expect(s.rows[0].reviewed).toBe(true);
  });
  it("optimistically recategorizes", () => {
    const base = txnReducer(initialTxnState, { type: "appendPage", page: { transactions: [t("x")], total: 1, hasMore: false } });
    const s = txnReducer(base, { type: "setCategory", id: "x", categoryId: "c9", categoryName: "Dining", categoryColor: "var(--data-orange)" });
    expect(s.rows[0].categoryId).toBe("c9");
    expect(s.rows[0].categoryName).toBe("Dining");
  });
  it("markAll flips every unreviewed non-transfer row", () => {
    const base = txnReducer(initialTxnState, { type: "appendPage", page: { transactions: [t("x"), t("y", { type: "transfer" })], total: 2, hasMore: false } });
    const s = txnReducer(base, { type: "markAll" });
    expect(s.rows.find((r) => r.id === "x")!.reviewed).toBe(true);
    expect(s.rows.find((r) => r.id === "y")!.reviewed).toBe(false); // transfers excluded, mirrors server
  });
  it("reset replaces rows (filter change)", () => {
    const base = txnReducer(initialTxnState, { type: "appendPage", page: { transactions: [t("x")], total: 1, hasMore: false } });
    const s = txnReducer(base, { type: "reset" });
    expect(s.rows).toEqual([]);
  });
});
