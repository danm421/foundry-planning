import { describe, it, expect } from "vitest";
import { buildAccountRail, assetCardSubtitle, debtCardSubtitle } from "../account-rail";
import type { PortalAccountRow, PortalDebtRow } from "../contracts";

function asset(over: Partial<PortalAccountRow> = {}): PortalAccountRow {
  return {
    id: "a1", name: "Acct", category: "cash", subType: "checking",
    last4: null, value: 100, isPlaidLinked: false, ...over,
  };
}

function debt(over: Partial<PortalDebtRow> = {}): PortalDebtRow {
  return {
    id: "l1", name: "Loan", balance: 100, rawBalance: 100, liabilityType: "mortgage",
    aprPercentage: null, statementBalance: null, minimumPayment: null,
    nextPaymentDueDate: null, isPlaidLinked: false, ownerFmIds: [], ownerEntityIds: [],
    ...over,
  };
}

describe("buildAccountRail", () => {
  it("returns zeroed totals and no rows for empty input", () => {
    const rail = buildAccountRail({ assets: [], debts: [] });
    expect(rail.netWorth).toBe(0);
    expect(rail.assets).toEqual({ total: 0, rows: [] });
    expect(rail.liabilities).toEqual({ total: 0, rows: [] });
  });

  it("orders asset rows by CATEGORY_ORDER regardless of input order", () => {
    const rail = buildAccountRail({
      assets: [
        asset({ id: "1", category: "real_estate", value: 500 }),
        asset({ id: "2", category: "cash", value: 10 }),
        asset({ id: "3", category: "retirement", value: 200 }),
      ],
      debts: [],
    });
    expect(rail.assets.rows.map((r) => r.category)).toEqual([
      "cash", "retirement", "real_estate",
    ]);
  });

  it("sums accounts within a category and totals the group", () => {
    const rail = buildAccountRail({
      assets: [
        asset({ id: "1", category: "cash", value: 10 }),
        asset({ id: "2", category: "cash", value: 15 }),
        asset({ id: "3", category: "taxable", value: 75 }),
      ],
      debts: [],
    });
    expect(rail.assets.rows[0]).toMatchObject({
      key: "asset:cash", kind: "asset", category: "cash", label: "Cash", total: 25,
    });
    expect(rail.assets.total).toBe(100);
  });

  it("appends unknown categories last and labels them with the raw key", () => {
    const rail = buildAccountRail({
      assets: [
        asset({ id: "1", category: "mystery_future_cat", value: 5 }),
        asset({ id: "2", category: "cash", value: 10 }),
      ],
      debts: [],
    });
    expect(rail.assets.rows.map((r) => r.category)).toEqual(["cash", "mystery_future_cat"]);
    expect(rail.assets.rows[1].label).toBe("mystery_future_cat");
  });

  it("keeps a row for a category whose accounts net to zero", () => {
    const rail = buildAccountRail({ assets: [asset({ category: "cash", value: 0 })], debts: [] });
    expect(rail.assets.rows).toHaveLength(1);
    expect(rail.assets.rows[0].total).toBe(0);
  });

  it("groups debts by liabilityType, ordered by TYPE_ORDER", () => {
    const rail = buildAccountRail({
      assets: [],
      debts: [
        debt({ id: "1", liabilityType: "credit_card", balance: 250 }),
        debt({ id: "2", liabilityType: "mortgage", balance: 400 }),
        debt({ id: "3", liabilityType: "mortgage", balance: 100 }),
      ],
    });
    expect(rail.liabilities.rows.map((r) => r.category)).toEqual(["mortgage", "credit_card"]);
    expect(rail.liabilities.rows[0]).toMatchObject({
      key: "liability:mortgage", kind: "liability", label: "Mortgage", total: 500,
    });
    expect(rail.liabilities.total).toBe(750);
  });

  it("buckets a null liabilityType as 'other' labelled Loan", () => {
    const rail = buildAccountRail({ assets: [], debts: [debt({ liabilityType: null, balance: 50 })] });
    expect(rail.liabilities.rows[0]).toMatchObject({
      key: "liability:other", category: "other", label: "Loan", total: 50,
    });
  });

  it("nets worth as assets minus liabilities", () => {
    const rail = buildAccountRail({
      assets: [asset({ value: 1000 })],
      debts: [debt({ balance: 250 })],
    });
    expect(rail.netWorth).toBe(750);
  });

  it("uses the household-share balance, not rawBalance", () => {
    const rail = buildAccountRail({
      assets: [],
      debts: [debt({ balance: 60, rawBalance: 120 })],
    });
    expect(rail.liabilities.total).toBe(60);
  });
});

describe("card subtitles", () => {
  it("joins category label and de-underscored subType for assets", () => {
    expect(assetCardSubtitle(asset({ category: "retirement", subType: "traditional_ira" })))
      .toBe("Retirement · traditional ira");
  });

  it("falls back to the raw category for an unknown asset category", () => {
    expect(assetCardSubtitle(asset({ category: "mystery_future_cat", subType: "other" })))
      .toBe("mystery_future_cat · other");
  });

  it("labels debts by liabilityType, defaulting to Loan", () => {
    expect(debtCardSubtitle(debt({ liabilityType: "heloc" }))).toBe("HELOC");
    expect(debtCardSubtitle(debt({ liabilityType: null }))).toBe("Loan");
  });
});
