import { describe, it, expect } from "vitest";

import type { HypotheticalEstateTax, ProjectionYear } from "@/engine/types";

import { formatMetric, getMetric, listMetrics } from "./metric-registry";
import "./metrics"; // side-effect: register all v1 metrics

/**
 * Minimal `ProjectionYear` builder for metric tests. Populates only the fields
 * the registered metrics actually read; `hypotheticalEstateTax` is required by
 * the type but unused by every metric in v1, so we satisfy the compiler with
 * a typed-stub cast rather than constructing a full estate-tax tree.
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
      total: 80_000,
      bySource: {},
      byLiability: {},
      interestByLiability: {},
    },
    savings: { byAccount: {}, total: 30_000, employerTotal: 0 },
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
      taxableTotal: 200_000,
      cashTotal: 50_000,
      retirementTotal: 750_000,
      realEstateTotal: 0,
      businessTotal: 0,
      lifeInsuranceTotal: 0,
      total: 1_000_000,
    },
    accountLedgers: {},
    accountBasisBoY: {},
    liabilityBalancesBoY: { mortgage: 200_000 },
    // The metric tests don't read this; satisfy the required type with a
    // typed stub instead of a full estate-tax tree.
    hypotheticalEstateTax: {} as unknown as HypotheticalEstateTax,
    ...overrides,
  };
}

const ctx = (projection: ProjectionYear[], year = 2026) => ({
  client: { id: "c" },
  projection,
  year,
});

describe("formatMetric", () => {
  it("formats currency", () => {
    expect(formatMetric(50_000, "currency")).toBe("$50,000");
  });

  it("formats percent (rate-shaped 0.234 -> 23.4%)", () => {
    expect(formatMetric(0.234, "percent")).toBe("23.4%");
  });

  it("formats years", () => {
    expect(formatMetric(12.5, "years")).toBe("12.5 yrs");
  });

  it("formats number", () => {
    expect(formatMetric(1234.6, "number")).toBe("1,235");
  });

  it("returns em-dash for null", () => {
    expect(formatMetric(null, "currency")).toBe("—");
  });
});

describe("metric registry", () => {
  it("registers all 10 v1 metrics", () => {
    const keys = listMetrics()
      .map((m) => m.key)
      .sort();
    expect(keys).toEqual([
      "annualSavings",
      "annualSpending",
      "currentMarginalTaxRate",
      "effectiveTaxRate",
      "liquidNetWorth",
      "monteCarloSuccessProbability",
      "netWorthAtRetirement",
      "netWorthNow",
      "taxableEstateValue",
      "yearsToDepletion",
    ]);
  });

  it("netWorthNow = portfolio.total - sum(liabilityBalancesBoY)", () => {
    const y = makeYear();
    expect(getMetric("netWorthNow").fetch(ctx([y]))).toBe(800_000);
  });

  it("annualSavings reads savings.total", () => {
    const y = makeYear();
    expect(getMetric("annualSavings").fetch(ctx([y]))).toBe(30_000);
  });

  it("annualSpending reads expenses.total", () => {
    const y = makeYear();
    expect(getMetric("annualSpending").fetch(ctx([y]))).toBe(80_000);
  });

  it("currentMarginalTaxRate returns null when taxResult missing", () => {
    const y = makeYear();
    expect(getMetric("currentMarginalTaxRate").fetch(ctx([y]))).toBeNull();
  });

  it("monteCarloSuccessProbability is null in v1", () => {
    expect(
      getMetric("monteCarloSuccessProbability").fetch(ctx([], 2026)),
    ).toBeNull();
  });

  it("returns null when projection is empty", () => {
    expect(getMetric("netWorthNow").fetch(ctx([], 2026))).toBeNull();
  });
});
