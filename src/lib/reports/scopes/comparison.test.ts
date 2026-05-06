// src/lib/reports/scopes/comparison.test.ts
//
// Tests for the comparison scope. Splits into two layers:
//
// 1. `buildComparisonScopeData` — pure shaping function that takes two
//    projections plus the resolved `cashflow / balance / monteCarlo /
//    allocation` scope payloads for each side and assembles the
//    `ComparisonScopeData` shape (incl. delta math). This is the
//    business-logic surface; tested with hand-built fixtures.
//
// 2. `loadComparisonScope` — DB-touching wrapper. Verified separately in a
//    tenant-isolation style test (see `src/__tests__/`); this file
//    focuses on the math.

import { describe, it, expect } from "vitest";

import type { HypotheticalEstateTax, ProjectionYear } from "@/engine/types";
import { buildComparisonScopeData } from "./comparison";
import type { CashflowScopeData } from "./cashflow";
import type { BalanceScopeData } from "./balance";
import type { MonteCarloScopeData } from "./monteCarlo";
import type { AllocationScopeData } from "./allocation";

// Minimal ProjectionYear builder — same pattern as data-loader.test.ts.
function makeYear(overrides: Partial<ProjectionYear> = {}): ProjectionYear {
  return {
    year: 2026,
    ages: { client: 60 },
    income: {
      salaries: 0,
      socialSecurity: 0,
      business: 0,
      trust: 0,
      deferred: 0,
      capitalGains: 0,
      other: 0,
      total: 0,
      bySource: {},
    },
    withdrawals: { byAccount: {}, total: 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    expenses: {
      living: 0,
      liabilities: 0,
      other: 0,
      insurance: 0,
      realEstate: 0,
      taxes: 0,
      total: 0,
      bySource: {},
      byLiability: {},
      interestByLiability: {},
    },
    savings: { byAccount: {}, total: 0, employerTotal: 0 },
    totalIncome: 0,
    totalExpenses: 0,
    netCashFlow: 0,
    portfolioAssets: {
      taxable: {},
      cash: {},
      retirement: {},
      realEstate: {},
      business: {},
      lifeInsurance: {},
      taxableTotal: 0,
      cashTotal: 0,
      retirementTotal: 0,
      realEstateTotal: 0,
      businessTotal: 0,
      lifeInsuranceTotal: 0,
      total: 0,
    },
    accountLedgers: {},
    accountBasisBoY: {},
    liabilityBalancesBoY: {},
    hypotheticalEstateTax: {} as unknown as HypotheticalEstateTax,
    ...overrides,
  };
}

const emptyAllocation: AllocationScopeData = { byClass: [], byType: [] };

function side(args: {
  projection: ProjectionYear[];
  cashflow: CashflowScopeData;
  balance: BalanceScopeData;
  monteCarlo: MonteCarloScopeData;
  allocation?: AllocationScopeData;
}) {
  return {
    projection: args.projection,
    cashflow: args.cashflow,
    balance: args.balance,
    monteCarlo: args.monteCarlo,
    allocation: args.allocation ?? emptyAllocation,
  };
}

describe("buildComparisonScopeData", () => {
  it("returns both current and proposed scope payloads on the result", () => {
    const proj = [makeYear({ year: 2026 }), makeYear({ year: 2027 })];
    const curCashflow: CashflowScopeData = {
      years: [
        {
          year: 2026,
          incomeWages: 100,
          incomeSocialSecurity: 0,
          incomePensions: 0,
          incomeWithdrawals: 0,
          incomeOther: 0,
          expenses: 50,
          savings: 10,
          net: 40,
        },
      ],
    };
    const propCashflow: CashflowScopeData = {
      years: [
        {
          year: 2026,
          incomeWages: 200,
          incomeSocialSecurity: 0,
          incomePensions: 0,
          incomeWithdrawals: 0,
          incomeOther: 0,
          expenses: 60,
          savings: 20,
          net: 120,
        },
      ],
    };
    const out = buildComparisonScopeData({
      current: side({
        projection: proj,
        cashflow: curCashflow,
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
      proposed: side({
        projection: proj,
        cashflow: propCashflow,
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
    });
    expect(out.current.cashflow).toBe(curCashflow);
    expect(out.proposed.cashflow).toBe(propCashflow);
  });

  it("delta.successProbability pulls from each side's monteCarlo scope", () => {
    const out = buildComparisonScopeData({
      current: side({
        projection: [makeYear()],
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: 0.62, bands: [] },
      }),
      proposed: side({
        projection: [makeYear()],
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: 0.91, bands: [] },
      }),
    });
    expect(out.delta.successProbability).toEqual({
      current: 0.62,
      proposed: 0.91,
    });
  });

  it("delta.successProbability surfaces 0 when scope reports null (stub case)", () => {
    // Today's monteCarlo scope is a stub that returns null. The comparison
    // shape must still render (advisor sees "0%" or "—", not a crash).
    const out = buildComparisonScopeData({
      current: side({
        projection: [makeYear()],
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
      proposed: side({
        projection: [makeYear()],
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
    });
    expect(out.delta.successProbability).toEqual({ current: 0, proposed: 0 });
  });

  it("delta.portfolioAtEnd reads the final-year portfolio total per side", () => {
    const cur = [
      makeYear({
        year: 2026,
        portfolioAssets: {
          ...makeYear().portfolioAssets,
          total: 1_000_000,
        },
      }),
      makeYear({
        year: 2027,
        portfolioAssets: {
          ...makeYear().portfolioAssets,
          total: 1_500_000,
        },
      }),
    ];
    const prop = [
      makeYear({
        year: 2026,
        portfolioAssets: {
          ...makeYear().portfolioAssets,
          total: 1_000_000,
        },
      }),
      makeYear({
        year: 2027,
        portfolioAssets: {
          ...makeYear().portfolioAssets,
          total: 2_500_000,
        },
      }),
    ];
    const out = buildComparisonScopeData({
      current: side({
        projection: cur,
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
      proposed: side({
        projection: prop,
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
    });
    expect(out.delta.portfolioAtEnd).toEqual({
      current: 1_500_000,
      proposed: 2_500_000,
    });
  });

  it("delta.netWorthAtEnd reads the last balance row's net worth per side", () => {
    const out = buildComparisonScopeData({
      current: side({
        projection: [makeYear()],
        cashflow: { years: [] },
        balance: {
          years: [
            { year: 2026, netWorth: 500_000, liquidNetWorth: 200_000 },
            { year: 2050, netWorth: 800_000, liquidNetWorth: 600_000 },
          ],
        },
        monteCarlo: { successProbability: null, bands: [] },
      }),
      proposed: side({
        projection: [makeYear()],
        cashflow: { years: [] },
        balance: {
          years: [
            { year: 2026, netWorth: 500_000, liquidNetWorth: 200_000 },
            { year: 2050, netWorth: 1_400_000, liquidNetWorth: 900_000 },
          ],
        },
        monteCarlo: { successProbability: null, bands: [] },
      }),
    });
    expect(out.delta.netWorthAtEnd).toEqual({
      current: 800_000,
      proposed: 1_400_000,
    });
  });

  it("delta.lifetimeTaxes sums expenses.taxes across every projection year per side", () => {
    const cur = [
      makeYear({
        year: 2026,
        expenses: { ...makeYear().expenses, taxes: 10_000 },
      }),
      makeYear({
        year: 2027,
        expenses: { ...makeYear().expenses, taxes: 12_500 },
      }),
      makeYear({
        year: 2028,
        expenses: { ...makeYear().expenses, taxes: 15_000 },
      }),
    ];
    const prop = [
      makeYear({
        year: 2026,
        expenses: { ...makeYear().expenses, taxes: 8_000 },
      }),
      makeYear({
        year: 2027,
        expenses: { ...makeYear().expenses, taxes: 9_000 },
      }),
      makeYear({
        year: 2028,
        expenses: { ...makeYear().expenses, taxes: 10_000 },
      }),
    ];
    const out = buildComparisonScopeData({
      current: side({
        projection: cur,
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
      proposed: side({
        projection: prop,
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
    });
    expect(out.delta.lifetimeTaxes).toEqual({
      current: 37_500,
      proposed: 27_000,
    });
  });

  it("returns 0 portfolio/netWorth deltas when projections are empty", () => {
    const out = buildComparisonScopeData({
      current: side({
        projection: [],
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
      proposed: side({
        projection: [],
        cashflow: { years: [] },
        balance: { years: [] },
        monteCarlo: { successProbability: null, bands: [] },
      }),
    });
    expect(out.delta.portfolioAtEnd).toEqual({ current: 0, proposed: 0 });
    expect(out.delta.netWorthAtEnd).toEqual({ current: 0, proposed: 0 });
    expect(out.delta.lifetimeTaxes).toEqual({ current: 0, proposed: 0 });
  });
});
