import { describe, it, expect } from "vitest";
import { detectRegimeTransitions } from "../tax-regime-indicators";
import type { ProjectionYear } from "@/engine";

function makeYear(overrides: Partial<{
  year: number;
  amtAdditional: number;
  niit: number;
  additionalMedicare: number;
  fica: number;
  marginalRate: number;
}> = {}): ProjectionYear {
  const {
    year = 2026,
    amtAdditional = 0,
    niit = 0,
    additionalMedicare = 0,
    fica = 0,
    marginalRate = 0.22,
  } = overrides;
  return {
    year,
    ages: { client: 60 },
    income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {} },
    withdrawals: { byAccount: {}, total: 0 },
    expenses: { living: 0, liabilities: 0, other: 0, insurance: 0, taxes: 0, total: 0, bySource: {} },
    savings: { byAccount: {}, total: 0 },
    accountBalances: {},
    netWorth: 0,
    netCashFlow: 0,
    taxResult: {
      income: {
        earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0,
        dividends: 0, capitalGains: 0, shortCapitalGains: 0,
        totalIncome: 0, nonTaxableIncome: 0, grossTotalIncome: 0,
      },
      flow: {
        aboveLineDeductions: 0, adjustedGrossIncome: 0, qbiDeduction: 0,
        belowLineDeductions: 0, taxableIncome: 0, incomeTaxBase: 0,
        regularTaxCalc: 0, amtCredit: 0, taxCredits: 0,
        regularFederalIncomeTax: 0, capitalGainsTax: 0,
        amtAdditional, niit, additionalMedicare, fica,
        stateTax: 0, totalFederalTax: 0, totalTax: 0,
      },
      diag: {
        marginalFederalRate: marginalRate,
        effectiveFederalRate: 0,
        bracketsUsed: {} as never,
        inflationFactor: 1,
      },
    },
  } as unknown as ProjectionYear;
}

describe("detectRegimeTransitions", () => {
  it("returns empty map for empty projection", () => {
    expect(detectRegimeTransitions([])).toEqual({});
  });

  it("returns empty map for single-year projection (no prior year to compare)", () => {
    const result = detectRegimeTransitions([makeYear({ year: 2026, amtAdditional: 1000 })]);
    expect(result).toEqual({});
  });

  it("returns empty map when all years look the same", () => {
    const years = [
      makeYear({ year: 2026, fica: 5000 }),
      makeYear({ year: 2027, fica: 5000 }),
      makeYear({ year: 2028, fica: 5000 }),
    ];
    expect(detectRegimeTransitions(years)).toEqual({});
  });

  it("detects first year AMT adds", () => {
    const years = [
      makeYear({ year: 2026, amtAdditional: 0 }),
      makeYear({ year: 2027, amtAdditional: 500 }),
      makeYear({ year: 2028, amtAdditional: 1200 }),
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2027]).toContain("amt_first_year");
    expect(result[2028]).toBeUndefined();
  });

  it("detects first year NIIT applies", () => {
    const years = [
      makeYear({ year: 2026, niit: 0 }),
      makeYear({ year: 2027, niit: 2000 }),
    ];
    expect(detectRegimeTransitions(years)[2027]).toContain("niit_first_year");
  });

  it("detects first year additional Medicare applies", () => {
    const years = [
      makeYear({ year: 2026, additionalMedicare: 0 }),
      makeYear({ year: 2027, additionalMedicare: 450 }),
    ];
    expect(detectRegimeTransitions(years)[2027]).toContain("addl_medicare_first_year");
  });

  it("detects retirement (FICA drops to 0)", () => {
    const years = [
      makeYear({ year: 2026, fica: 5000 }),
      makeYear({ year: 2027, fica: 0 }),
    ];
    expect(detectRegimeTransitions(years)[2027]).toContain("retirement_fica_zero");
  });

  it("detects marginal rate jump of 5+ percentage points (upward only)", () => {
    const years = [
      makeYear({ year: 2026, marginalRate: 0.22 }),
      makeYear({ year: 2027, marginalRate: 0.32 }), // +10pts
      makeYear({ year: 2028, marginalRate: 0.24 }), // -8pts, should not trigger (downward)
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2027]).toContain("marginal_rate_jump");
    expect(result[2028]).toBeUndefined();
  });

  it("does not trigger marginal rate jump for <5pt increases", () => {
    const years = [
      makeYear({ year: 2026, marginalRate: 0.22 }),
      makeYear({ year: 2027, marginalRate: 0.24 }), // +2pts
    ];
    expect(detectRegimeTransitions(years)[2027]).toBeUndefined();
  });

  it("records multiple transitions for the same year", () => {
    const years = [
      makeYear({ year: 2026, amtAdditional: 0, niit: 0 }),
      makeYear({ year: 2027, amtAdditional: 1000, niit: 500 }),
    ];
    const transitions = detectRegimeTransitions(years)[2027];
    expect(transitions).toContain("amt_first_year");
    expect(transitions).toContain("niit_first_year");
    expect(transitions).toHaveLength(2);
  });

  it("does not re-trigger amt_first_year on subsequent AMT years", () => {
    const years = [
      makeYear({ year: 2026, amtAdditional: 0 }),
      makeYear({ year: 2027, amtAdditional: 500 }),
      makeYear({ year: 2028, amtAdditional: 800 }),
      makeYear({ year: 2029, amtAdditional: 1200 }),
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2027]).toContain("amt_first_year");
    expect(result[2028]).toBeUndefined();
    expect(result[2029]).toBeUndefined();
  });

  it("handles years without taxResult (defensive)", () => {
    const years: ProjectionYear[] = [
      makeYear({ year: 2026, fica: 5000 }),
      { ...makeYear({ year: 2027 }), taxResult: undefined } as ProjectionYear,
      makeYear({ year: 2028, fica: 5000 }),
    ];
    // Should not crash; missing taxResult = no transitions detected
    expect(() => detectRegimeTransitions(years)).not.toThrow();
  });
});
