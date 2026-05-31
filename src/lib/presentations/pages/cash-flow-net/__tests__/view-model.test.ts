import { describe, it, expect } from "vitest";
import { buildNetCashFlowDrillData } from "../view-model";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";
import type { ProjectionYear } from "@/engine/types";

// A year whose supplemental withdrawals include `ghost` — an account absent
// from clientData.accounts AND every portfolioAssets bucket, so it never gets a
// category. `ira1` lives in the retirement bucket map, so it categorizes. Total
// withdrawals (10_000) therefore exceeds the categorized sum (8_000) by ghost's
// 2_000 — the H4 reconciliation gap.
function ghostYear(): ProjectionYear {
  return {
    year: 2040,
    ages: { client: 74, spouse: 70 },
    income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {} },
    withdrawals: { byAccount: { ira1: 8_000, ghost: 2_000 }, total: 10_000 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    portfolioAssets: {
      taxable: {}, cash: {}, retirement: { ira1: 500_000 }, realEstate: {}, business: {}, lifeInsurance: {},
      taxableTotal: 0, cashTotal: 0, retirementTotal: 500_000, realEstateTotal: 0, businessTotal: 0,
      lifeInsuranceTotal: 0, trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
      accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0, total: 500_000, liquidTotal: 500_000,
    },
    accountLedgers: {},
  } as unknown as ProjectionYear;
}

const base = {
  years: [ghostYear()],
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "lifetime" as const, showCallout: false },
};

describe("buildNetCashFlowDrillData — H4 reconciliation", () => {
  it("category columns + Other sum to total withdrawals", () => {
    const data = buildNetCashFlowDrillData(base);
    const r = data.table.rows[0].cells;
    const cols = data.table.columns
      .filter((c) => !["total", "boy", "wdPct"].includes(c.key))
      .map((c) => c.key);
    const sum = cols.reduce((s, k) => s + (r[k] ?? 0), 0);
    expect(sum).toBe(r.total); // 10_000
  });

  it("surfaces uncategorized withdrawals in an Other column", () => {
    const data = buildNetCashFlowDrillData(base);
    const otherCol = data.table.columns.find((c) => c.key === "other");
    expect(otherCol).toBeDefined();
    expect(data.table.rows[0].cells.other).toBe(2_000);
  });
});
