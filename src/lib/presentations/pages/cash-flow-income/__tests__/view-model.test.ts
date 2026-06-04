import { describe, it, expect } from "vitest";
import { buildIncomeDrillData } from "../view-model";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";
import type { ProjectionYear } from "@/engine/types";

// A retirement year whose canonical `totalIncome` (the reconciling engine field,
// projection.ts:4593) exceeds `income.total` because it folds in household RMD
// income and notes-receivable cash-in, neither of which is an `income.*`
// breakdown line. The income drill's "Total" must use `totalIncome` so it ties
// to the main Cash Flow page's Total Income column (F80).
function rmdYear(): ProjectionYear {
  return {
    year: 2040,
    ages: { client: 74, spouse: 70 },
    income: {
      salaries: 0,
      socialSecurity: 33_000,
      business: 5_000,
      trust: 0,
      deferred: 0,
      capitalGains: 2_000,
      other: 0,
      total: 40_000,
      bySource: {},
    },
    // 40k base income + 50k household RMDs + 10k notes-receivable cash-in.
    totalIncome: 100_000,
    withdrawals: { byAccount: {}, total: 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    portfolioAssets: {
      taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {},
      taxableTotal: 0, cashTotal: 0, retirementTotal: 0, realEstateTotal: 0, businessTotal: 0,
      lifeInsuranceTotal: 0, trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
      accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0, total: 0, liquidTotal: 0,
    },
    accountLedgers: {},
  } as unknown as ProjectionYear;
}

const base = {
  years: [rmdYear()],
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "full" as const, showCallout: false },
};

describe("buildIncomeDrillData — Total reconciles to engine totalIncome (F80)", () => {
  it("uses py.totalIncome (incl. RMDs + notes), not py.income.total", () => {
    const data = buildIncomeDrillData(base);
    const r = data.table.rows.find((row) => row.year === 2040);
    expect(r?.cells.total).toBe(100_000); // not 40_000 (income.total)
  });

  it("breakdown columns sum below Total when RMDs/notes are present", () => {
    // The drill intentionally has no RMD/notes columns, so the visible columns
    // sum to income.total while Total shows the larger reconciling figure —
    // matching the main Cash Flow page (which carries RMDs as a separate bar).
    const data = buildIncomeDrillData(base);
    const r = data.table.rows.find((row) => row.year === 2040)!;
    const colKeys = data.table.columns.filter((c) => c.key !== "total").map((c) => c.key);
    const colSum = colKeys.reduce((s, k) => s + (r.cells[k] ?? 0), 0);
    expect(colSum).toBe(40_000);
    expect(r.cells.total).toBeGreaterThan(colSum);
  });
});
