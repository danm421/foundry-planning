import { describe, it, expect } from "vitest";
import { computeTaxForYear } from "../year-tax";
import { emptyCharityCarryforward } from "../types";
import { makeEmptyTaxParams } from "../tax";
import type { YearTaxInput } from "../year-tax";

function input(over: Partial<YearTaxInput> = {}): YearTaxInput {
  const params = makeEmptyTaxParams(2026);
  params.incomeBrackets.married_joint = [{ from: 0, to: null, rate: 0.22 }];
  params.stdDeduction.married_joint = 32_200;
  return {
    taxDetail: {
      earnedIncome: 200_000, ordinaryIncome: 0, dividends: 0,
      capitalGains: 0, stCapitalGains: 0, qbi: 0,
      taxExempt: 0, taxExemptInterest: 0, bySource: {},
    } as YearTaxInput["taxDetail"],
    socialSecurityGross: 0, totalIncome: 200_000, taxableIncome: 200_000,
    filingStatus: "married_joint", year: 2026,
    planSettings: { flatFederalRate: 0.22, flatStateRate: 0, inflationRate: 0.03,
      planStartYear: 2026, planEndYear: 2056 } as YearTaxInput["planSettings"],
    resolved: { params, inflationFactor: 1 },
    useBracket: true,
    aboveLineDeductions: 0, itemizedDeductions: 0,
    charityCarryforwardIn: emptyCharityCarryforward(),
    charityGiftsThisYear: [],
    secaResult: { seTax: 0, deductibleHalf: 0 },
    transferEarlyWithdrawalPenalty: 0,
    interestIncomeForTax: 0,
    deductionBreakdownIn: null,
    capitalLossCarryforwardIn: { shortTerm: 0, longTerm: 0 },
    capitalGainsInTaxableIncome: { longTerm: 0, shortTerm: 0 },
    ...over,
  };
}

describe("computeTaxForYear capital-loss carryforward", () => {
  it("returns the carryforward produced by a loss year", () => {
    const out = computeTaxForYear(input({
      taxDetail: { ...input().taxDetail, capitalGains: -40_000 },
    }));
    expect(out.capitalLossCarryforwardOut.longTerm).toBe(37_000);
  });

  it("consumes an incoming carryforward", () => {
    const out = computeTaxForYear(input({
      capitalLossCarryforwardIn: { shortTerm: 0, longTerm: 10_000 },
    }));
    expect(out.capitalLossCarryforwardOut.longTerm).toBe(7_000);
  });

  // C1: flat mode used to pass the carryforward through UNTOUCHED — the
  // §1211(b) offset and the §1212(b) drawdown only existed on the bracket path.
  // It now runs the same netting, so the carryforward draws down here too,
  // short-term first.
  it("draws the carryforward down under §1211(b)/§1212(b) in flat mode", () => {
    const out = computeTaxForYear(input({
      useBracket: false,
      capitalLossCarryforwardIn: { shortTerm: 500, longTerm: 9_000 },
    }));
    // 3,000 deduction absorbs all 500 of ST loss, then 2,500 of the LT loss.
    expect(out.taxResult.capitalLoss.deduction).toBe(3_000);
    expect(out.capitalLossCarryforwardOut).toEqual({ shortTerm: 0, longTerm: 6_500 });
    // 200,000 taxable − 3,000 offset, at the fixture's 22% flat federal rate.
    expect(out.taxResult.flow.taxableIncome).toBe(197_000);
  });
});
