import { describe, it, expect } from "vitest";
import { buildBreakdown, buildWhereHeld } from "../analysis-detail";
import type { AssetClassDetail, AccountDetail } from "../analysis-dataset";

const stats = (m: number) => ({ arithmeticMean: m, geometricReturn: m, stdDev: 0.1, sharpe: 1 });
const classes: AssetClassDetail[] = [
  { id: "eq", name: "Equity", sortOrder: 0, assetType: "equities",
    stats: stats(0.08), tax: { ordinaryIncome: 0, ltCapitalGains: 1, qualifiedDividends: 0, taxExempt: 0 } },
  { id: "bd", name: "Bonds", sortOrder: 1, assetType: "taxable_bonds",
    stats: stats(0.04), tax: { ordinaryIncome: 1, ltCapitalGains: 0, qualifiedDividends: 0, taxExempt: 0 } },
];

describe("buildBreakdown", () => {
  it("joins weights to class stats, computes weight*value, sorts by weight desc", () => {
    const rows = buildBreakdown(
      [{ assetClassId: "bd", weight: 0.25 }, { assetClassId: "eq", weight: 0.75 }],
      1000, classes,
    );
    expect(rows.map((r) => r.assetClassId)).toEqual(["eq", "bd"]); // sorted desc
    expect(rows[0].value).toBe(750);
    expect(rows[0].name).toBe("Equity");
    expect(rows[0].stats.arithmeticMean).toBe(0.08);
  });

  it("yields null value when groupValue is null (model portfolios)", () => {
    const rows = buildBreakdown([{ assetClassId: "eq", weight: 1 }], null, classes);
    expect(rows[0].value).toBeNull();
  });

  it("drops weights whose class is unknown", () => {
    const rows = buildBreakdown([{ assetClassId: "ghost", weight: 1 }], 100, classes);
    expect(rows).toEqual([]);
  });
});

describe("buildWhereHeld", () => {
  const accountsById: Record<string, AccountDetail> = {
    a1: { name: "401k", category: "retirement", value: 1000,
          weights: [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bd", weight: 0.4 }] },
    a2: { name: "Brokerage", category: "taxable", value: 500,
          weights: [{ assetClassId: "eq", weight: 1 }] },
    a3: { name: "Cash", category: "taxable", value: 200,
          weights: [{ assetClassId: "bd", weight: 1 }] },
  };
  const categoryMembers = { retirement: ["a1"], taxable: ["a2", "a3"] };
  const customGroupMembers = { g1: ["a1", "a2"] };

  it("lists holding accounts with class dollars and totals", () => {
    const r = buildWhereHeld("eq", accountsById, categoryMembers, customGroupMembers);
    expect(r.accounts.map((a) => a.accountId).sort()).toEqual(["a1", "a2"]);
    const a1 = r.accounts.find((a) => a.accountId === "a1")!;
    expect(a1.classValue).toBeCloseTo(600, 5); // 1000 * 0.6
    expect(r.totalClassValue).toBeCloseTo(1100, 5); // 600 + 500
  });

  it("rolls up by category and custom group", () => {
    const r = buildWhereHeld("eq", accountsById, categoryMembers, customGroupMembers);
    const cat = Object.fromEntries(r.byCategory.map((c) => [c.category, c.classValue]));
    expect(cat["retirement"]).toBeCloseTo(600, 5);
    expect(cat["taxable"]).toBeCloseTo(500, 5);
    const grp = Object.fromEntries(r.byCustomGroup.map((g) => [g.groupId, g.classValue]));
    expect(grp["g1"]).toBeCloseTo(1100, 5); // a1(600) + a2(500)
  });

  it("returns empty rollup for a class no account holds", () => {
    const r = buildWhereHeld("ghost", accountsById, categoryMembers, customGroupMembers);
    expect(r.accounts).toEqual([]);
    expect(r.totalClassValue).toBe(0);
  });
});
