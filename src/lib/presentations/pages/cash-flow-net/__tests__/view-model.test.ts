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
  options: { range: "full" as const, showCallout: false },
};

// F82: the Withdrawal % numerator adds RMDs to supplemental withdrawals. The
// engine sets `rmdAmount` on EVERY rmd-enabled ledger, including entity-owned
// (non-IIP trust) accounts whose RMD routes to entity checking — not a
// household supplemental withdrawal. `prevYear` sets the BoY denominator;
// `rmdYear` has a household ira1 RMD (40k, in the retirement bucket) and an
// entity-owned trustIra RMD (25k, in trustsAndBusinesses — never categorized).
function prevYear(): ProjectionYear {
  return {
    year: 2039,
    ages: { client: 73, spouse: 69 },
    income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {} },
    withdrawals: { byAccount: {}, total: 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    portfolioAssets: {
      taxable: {}, cash: {}, retirement: { ira1: 1_000_000 }, realEstate: {}, business: {}, lifeInsurance: {},
      taxableTotal: 0, cashTotal: 0, retirementTotal: 1_000_000, realEstateTotal: 0, businessTotal: 0,
      lifeInsuranceTotal: 0, trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
      accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0, total: 1_000_000, liquidTotal: 1_000_000,
    },
    accountLedgers: {},
  } as unknown as ProjectionYear;
}

function rmdYear(): ProjectionYear {
  return {
    year: 2040,
    ages: { client: 74, spouse: 70 },
    income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {} },
    withdrawals: { byAccount: {}, total: 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    portfolioAssets: {
      taxable: {}, cash: {}, retirement: { ira1: 960_000 }, realEstate: {}, business: {}, lifeInsurance: {},
      taxableTotal: 0, cashTotal: 0, retirementTotal: 960_000, realEstateTotal: 0, businessTotal: 0,
      lifeInsuranceTotal: 0, trustsAndBusinesses: { trustIra: 300_000 }, trustsAndBusinessesTotal: 300_000,
      accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0, total: 1_260_000, liquidTotal: 960_000,
    },
    accountLedgers: {
      ira1: { beginningValue: 1_000_000, growth: 0, contributions: 0, distributions: 40_000, internalContributions: 0, internalDistributions: 0, rmdAmount: 40_000, fees: 0, endingValue: 960_000, entries: [] },
      trustIra: { beginningValue: 300_000, growth: 0, contributions: 0, distributions: 25_000, internalContributions: 0, internalDistributions: 0, rmdAmount: 25_000, fees: 0, endingValue: 275_000, entries: [] },
    },
  } as unknown as ProjectionYear;
}

describe("buildNetCashFlowDrillData — Withdrawal % excludes entity-owned RMDs (F82)", () => {
  it("counts only household RMDs in the withdrawal-% numerator", () => {
    const data = buildNetCashFlowDrillData({
      ...base,
      years: [prevYear(), rmdYear()],
    });
    const r2040 = data.table.rows.find((row) => row.year === 2040);
    // boy = 1_000_000; numerator = withdrawals.total(0) + household RMD(40k) only.
    // Buggy code added trustIra's 25k → 0.065. Correct = 40k / 1,000,000 = 0.04.
    expect(r2040?.cells.wdPct).toBeCloseTo(0.04, 10);
  });
});

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
