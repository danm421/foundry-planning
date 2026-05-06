// src/lib/reports/scope-registry.test.ts
import { describe, it, expect } from "vitest";

import type { HypotheticalEstateTax, ProjectionYear } from "@/engine/types";

import { getScope } from "./scope-registry";
import type { AllocationScopeData } from "./scopes/allocation";
import type { BalanceScopeData } from "./scopes/balance";
import type { CashflowScopeData } from "./scopes/cashflow";
import type { MonteCarloScopeData } from "./scopes/monteCarlo";
import "./scopes"; // side-effect: register all v1 scopes

/**
 * Minimal `ProjectionYear` builder for scope tests. Mirrors the helper used
 * by `metric-registry.test.ts` and `data-loader.test.ts`. `hypotheticalEstateTax`
 * is required by the type but unused by the cashflow scope, so we satisfy the
 * compiler with a typed-stub cast rather than a full estate-tax tree.
 */
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
      trustsAndBusinesses: {},
      accessibleTrustAssets: {},
      trustsAndBusinessesTotal: 0,
      accessibleTrustAssetsTotal: 0,
      total: 0,
    },
    accountLedgers: {},
    accountBasisBoY: {},
    liabilityBalancesBoY: {},
    hypotheticalEstateTax: {} as unknown as HypotheticalEstateTax,
    ...overrides,
  };
}

const clientCtx = { id: "c-1" };

describe("cashflow scope — fetch", () => {
  it("maps a single ProjectionYear to the expected flat shape", () => {
    const y = makeYear({
      year: 2026,
      income: {
        salaries: 100_000,
        socialSecurity: 20_000,
        business: 5_000,
        trust: 1_000,
        deferred: 2_000,
        capitalGains: 4_000,
        other: 500,
        total: 132_500,
        bySource: {},
      },
      withdrawals: { byAccount: {}, total: 30_000 },
      // entityWithdrawals must NOT be folded into incomeWithdrawals.
      entityWithdrawals: { byAccount: {}, total: 999_999 },
      expenses: {
        living: 60_000,
        liabilities: 10_000,
        other: 5_000,
        insurance: 2_000,
        realEstate: 3_000,
        taxes: 20_000,
        total: 100_000,
        bySource: {},
        byLiability: {},
        interestByLiability: {},
      },
      savings: { byAccount: {}, total: 25_000, employerTotal: 5_000 },
      netCashFlow: 7_500,
    });

    const data = getScope("cashflow").fetch({
      client: clientCtx,
      projection: [y],
    }) as CashflowScopeData;

    expect(data.years).toHaveLength(1);
    expect(data.years[0]).toEqual({
      year: 2026,
      incomeWages: 100_000,
      incomeSocialSecurity: 20_000,
      // Engine doesn't expose pensions yet — see future-work/engine.md.
      incomePensions: 0,
      // Pure household withdrawals; entityWithdrawals stays out.
      incomeWithdrawals: 30_000,
      // Aggregated residual: business+trust+deferred+capitalGains+other.
      incomeOther: 5_000 + 1_000 + 2_000 + 4_000 + 500,
      expenses: 100_000,
      savings: 25_000,
      net: 7_500,
    });
  });

  it("maps multiple years preserving order", () => {
    const projection = [
      makeYear({ year: 2026, expenses: { ...emptyExpenses(), total: 80_000 } }),
      makeYear({ year: 2027, expenses: { ...emptyExpenses(), total: 95_000 } }),
      makeYear({ year: 2028, expenses: { ...emptyExpenses(), total: 90_000 } }),
    ];
    const data = getScope("cashflow").fetch({
      client: clientCtx,
      projection,
    }) as CashflowScopeData;
    expect(data.years.map((y) => y.year)).toEqual([2026, 2027, 2028]);
    expect(data.years.map((y) => y.expenses)).toEqual([80_000, 95_000, 90_000]);
  });
});

describe("cashflow scope — serializeForAI", () => {
  it("returns a no-data sentinel for an empty projection", () => {
    const data = getScope("cashflow").fetch({
      client: clientCtx,
      projection: [],
    });
    expect(getScope("cashflow").serializeForAI(data)).toBe("Cashflow: no data.");
  });

  it("mentions first.year, last.year, and peak.year", () => {
    const projection = [
      makeYear({ year: 2026, expenses: { ...emptyExpenses(), total: 80_000 } }),
      // Peak in the middle so first.year !== peak.year !== last.year.
      makeYear({ year: 2027, expenses: { ...emptyExpenses(), total: 120_000 } }),
      makeYear({ year: 2028, expenses: { ...emptyExpenses(), total: 95_000 } }),
    ];
    const data = getScope("cashflow").fetch({
      client: clientCtx,
      projection,
    });
    const text = getScope("cashflow").serializeForAI(data);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("2026");
    expect(text).toContain("2028");
    expect(text).toContain("Peak expense year: 2027");
  });

  it("sums all income components into the reported income figure", () => {
    const y = makeYear({
      year: 2026,
      income: {
        salaries: 100_000,
        socialSecurity: 20_000,
        business: 5_000,
        trust: 1_000,
        deferred: 2_000,
        capitalGains: 4_000,
        other: 500,
        total: 132_500,
        bySource: {},
      },
      withdrawals: { byAccount: {}, total: 10_000 },
      expenses: { ...emptyExpenses(), total: 50_000 },
      savings: { byAccount: {}, total: 15_000, employerTotal: 0 },
    });
    const data = getScope("cashflow").fetch({
      client: clientCtx,
      projection: [y],
    });
    const text = getScope("cashflow").serializeForAI(data);
    // 100k + 20k + 0 (pension) + 10k withdrawals + (5k+1k+2k+4k+0.5k) other = 142_500
    expect(text).toContain("$142500");
    expect(text).toContain("$50000");
    expect(text).toContain("$15000");
  });
});

describe("balance scope — fetch", () => {
  it("maps a 2-year projection to net worth and liquid net worth", () => {
    const projection = [
      makeYear({
        year: 2026,
        portfolioAssets: {
          taxable: { acc1: 200_000 },
          cash: { acc2: 50_000 },
          retirement: { acc3: 400_000 },
          realEstate: { home: 600_000 },
          business: {},
          lifeInsurance: {},
          taxableTotal: 200_000,
          cashTotal: 50_000,
          retirementTotal: 400_000,
          realEstateTotal: 600_000,
          businessTotal: 0,
          lifeInsuranceTotal: 0,
          trustsAndBusinesses: {},
          accessibleTrustAssets: {},
          trustsAndBusinessesTotal: 0,
          accessibleTrustAssetsTotal: 0,
          // Total assets at EoY.
          total: 1_250_000,
        },
        // Two outstanding liabilities at BoY (mortgage + HELOC).
        liabilityBalancesBoY: { mortgage: 300_000, heloc: 50_000 },
      }),
      makeYear({
        year: 2027,
        portfolioAssets: {
          taxable: {},
          cash: {},
          retirement: {},
          realEstate: {},
          business: {},
          lifeInsurance: {},
          taxableTotal: 220_000,
          cashTotal: 60_000,
          retirementTotal: 430_000,
          realEstateTotal: 615_000,
          businessTotal: 0,
          lifeInsuranceTotal: 0,
          trustsAndBusinesses: {},
          accessibleTrustAssets: {},
          trustsAndBusinessesTotal: 0,
          accessibleTrustAssetsTotal: 0,
          total: 1_325_000,
        },
        liabilityBalancesBoY: { mortgage: 290_000, heloc: 45_000 },
      }),
    ];

    const data = getScope("balance").fetch({
      client: clientCtx,
      projection,
    }) as BalanceScopeData;

    expect(data.years).toHaveLength(2);
    expect(data.years[0]).toEqual({
      year: 2026,
      // 1_250_000 assets − (300k + 50k) liabilities = 900k.
      netWorth: 900_000,
      // cash 50k + taxable 200k = 250k. Liabilities are NOT subtracted from
      // liquid — see balance.ts header for the reasoning.
      liquidNetWorth: 250_000,
    });
    expect(data.years[1]).toEqual({
      year: 2027,
      // 1_325_000 − (290k + 45k) = 990k.
      netWorth: 990_000,
      // 60k cash + 220k taxable = 280k.
      liquidNetWorth: 280_000,
    });
  });

  it("treats a year with no liabilities as netWorth = portfolioAssets.total", () => {
    const y = makeYear({
      year: 2030,
      portfolioAssets: {
        taxable: {},
        cash: {},
        retirement: {},
        realEstate: {},
        business: {},
        lifeInsurance: {},
        taxableTotal: 0,
        cashTotal: 0,
        retirementTotal: 500_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        trustsAndBusinesses: {},
        accessibleTrustAssets: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssetsTotal: 0,
        total: 500_000,
      },
      liabilityBalancesBoY: {},
    });
    const data = getScope("balance").fetch({
      client: clientCtx,
      projection: [y],
    }) as BalanceScopeData;
    expect(data.years[0].netWorth).toBe(500_000);
    expect(data.years[0].liquidNetWorth).toBe(0);
  });
});

describe("balance scope — serializeForAI", () => {
  it("returns a no-data sentinel for an empty projection", () => {
    const data = getScope("balance").fetch({
      client: clientCtx,
      projection: [],
    });
    expect(getScope("balance").serializeForAI(data)).toBe("Balance: no data.");
  });

  it("mentions both first.year, last.year, and both netWorth values", () => {
    const projection = [
      makeYear({
        year: 2026,
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
          trustsAndBusinesses: {},
          accessibleTrustAssets: {},
          trustsAndBusinessesTotal: 0,
          accessibleTrustAssetsTotal: 0,
          total: 1_000_000,
        },
        liabilityBalancesBoY: { mortgage: 200_000 },
      }),
      makeYear({
        year: 2030,
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
          trustsAndBusinesses: {},
          accessibleTrustAssets: {},
          trustsAndBusinessesTotal: 0,
          accessibleTrustAssetsTotal: 0,
          total: 1_500_000,
        },
        liabilityBalancesBoY: {},
      }),
    ];
    const data = getScope("balance").fetch({
      client: clientCtx,
      projection,
    });
    const text = getScope("balance").serializeForAI(data);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("2026");
    expect(text).toContain("2030");
    // first netWorth: 1_000_000 − 200_000 = 800_000.
    expect(text).toContain("$800000");
    // last netWorth: 1_500_000 − 0 = 1_500_000.
    expect(text).toContain("$1500000");
  });
});

describe("allocation scope — fetch", () => {
  it("maps the current year's portfolioAssets totals into byClass with pct", () => {
    const y = makeYear({
      year: 2026,
      portfolioAssets: {
        cash: { savings: 50_000 },
        taxable: { brokerage: 200_000 },
        retirement: { ira: 400_000 },
        realEstate: { home: 600_000 },
        business: {},
        lifeInsurance: { whole: 50_000 },
        cashTotal: 50_000,
        taxableTotal: 200_000,
        retirementTotal: 400_000,
        realEstateTotal: 600_000,
        businessTotal: 0,
        lifeInsuranceTotal: 50_000,
        trustsAndBusinesses: {},
        accessibleTrustAssets: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssetsTotal: 0,
        // Sum: 1_300_000.
        total: 1_300_000,
      },
    });

    const data = getScope("allocation").fetch({
      client: clientCtx,
      projection: [y],
    }) as AllocationScopeData;

    // Business (zero) is filtered; the other 5 categories survive in order.
    expect(data.byClass.map((b) => b.className)).toEqual([
      "Cash",
      "Taxable",
      "Retirement",
      "Real Estate",
      "Life Insurance",
    ]);
    expect(data.byClass.map((b) => b.value)).toEqual([
      50_000, 200_000, 400_000, 600_000, 50_000,
    ]);
    // pct = value / 1_300_000.
    expect(data.byClass[0].pct).toBeCloseTo(50_000 / 1_300_000, 6);
    expect(data.byClass[3].pct).toBeCloseTo(600_000 / 1_300_000, 6);
    // byType is intentionally empty in v1 — engine has no asset-type rollup.
    expect(data.byType).toEqual([]);
  });

  it("returns empty arrays when projection is empty", () => {
    const data = getScope("allocation").fetch({
      client: clientCtx,
      projection: [],
    }) as AllocationScopeData;
    expect(data).toEqual({ byClass: [], byType: [] });
  });
});

describe("allocation scope — serializeForAI", () => {
  it("returns a no-data sentinel for an empty projection", () => {
    const data = getScope("allocation").fetch({
      client: clientCtx,
      projection: [],
    });
    expect(getScope("allocation").serializeForAI(data)).toBe(
      "Allocation: no data.",
    );
  });

  it("mentions each non-zero category with a percentage", () => {
    const y = makeYear({
      year: 2026,
      portfolioAssets: {
        cash: {},
        taxable: {},
        retirement: {},
        realEstate: {},
        business: {},
        lifeInsurance: {},
        cashTotal: 100_000,
        taxableTotal: 0,
        retirementTotal: 300_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        trustsAndBusinesses: {},
        accessibleTrustAssets: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssetsTotal: 0,
        total: 400_000,
      },
    });
    const data = getScope("allocation").fetch({
      client: clientCtx,
      projection: [y],
    });
    const text = getScope("allocation").serializeForAI(data);
    expect(text).toContain("Cash 25%");
    expect(text).toContain("Retirement 75%");
    // Filtered-out zero categories should not appear.
    expect(text).not.toContain("Taxable");
    expect(text).not.toContain("Business");
  });
});

describe("monteCarlo scope — fetch (stub)", () => {
  // The v1 monteCarlo scope is a documented stub — see scopes/monteCarlo.ts.
  // These tests pin the stub shape so the dependent widget keeps rendering
  // its placeholder cleanly until the real engine wiring lands.
  it("returns null successProbability and empty bands", () => {
    const data = getScope("monteCarlo").fetch({
      client: clientCtx,
      projection: [],
    }) as MonteCarloScopeData;
    expect(data).toEqual({ successProbability: null, bands: [] });
  });
});

describe("monteCarlo scope — serializeForAI", () => {
  it("returns the v1 stub sentinel when successProbability is null", () => {
    const data = getScope("monteCarlo").fetch({
      client: clientCtx,
      projection: [],
    });
    expect(getScope("monteCarlo").serializeForAI(data)).toBe(
      "Monte Carlo: not yet wired (v1 stub).",
    );
  });

  it("formats a populated payload as a single-sentence summary", () => {
    // The serializer must keep working once real data arrives — exercise the
    // populated branch via a hand-constructed payload (the stub fetcher will
    // never return this in v1, but the wired implementation will).
    const populated: MonteCarloScopeData = {
      successProbability: 0.85,
      bands: [
        { year: 2026, p5: 100, p25: 200, p50: 300, p75: 400, p95: 500 },
        { year: 2027, p5: 110, p25: 210, p50: 310, p75: 410, p95: 510 },
      ],
    };
    expect(getScope("monteCarlo").serializeForAI(populated)).toBe(
      "Monte Carlo success probability 85% over 2 years.",
    );
  });
});

function emptyExpenses(): ProjectionYear["expenses"] {
  return {
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
  };
}
