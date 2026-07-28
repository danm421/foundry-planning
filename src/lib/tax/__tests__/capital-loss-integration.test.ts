import { describe, it, expect } from "vitest";
import { calculateTaxYear } from "../calculate";
import type { CalcInput } from "../types";
import { makeEmptyTaxParams } from "@/engine/tax";

function baseInput(over: Partial<CalcInput> = {}): CalcInput {
  const params = makeEmptyTaxParams(2026);
  params.incomeBrackets.married_joint = [
    { from: 0, to: 100_000, rate: 0.1 },
    { from: 100_000, to: null, rate: 0.24 },
  ];
  params.capGainsBrackets.married_joint = { zeroPctTop: 96_700, fifteenPctTop: 600_050 };
  params.stdDeduction.married_joint = 32_200;
  params.niitRate = 0.038;
  params.niitThreshold = { mfj: 250_000, single: 200_000, mfs: 125_000 };
  // Seed realistic AMT exemption/phase-out so a filer whose taxable income is
  // floored to $0 by a large loss doesn't hit phantom AMT from the §56(b)(1)(E)
  // standard-deduction add-back landing on an unseeded (zero) exemption —
  // `makeEmptyTaxParams` defaults these to 0, which is fine for the other
  // assertions here but wrong for the zero-income floor test below.
  params.amtExemption = { mfj: 150_000, singleHoh: 150_000, mfs: 75_000 };
  params.amtPhaseoutStart = { mfj: 1_000_000, singleHoh: 1_000_000, mfs: 500_000 };
  return {
    year: 2026, filingStatus: "married_joint",
    earnedIncome: 200_000, ordinaryIncome: 0, qualifiedDividends: 0,
    longTermCapitalGains: 0, shortTermCapitalGains: 0, qbiIncome: 0,
    taxExemptIncome: 0, socialSecurityGross: 0,
    aboveLineDeductions: 0, itemizedDeductions: 0,
    flatStateRate: 0, taxParams: params, inflationFactor: 1,
    ...over,
  };
}

describe("capital losses inside calculateTaxYear", () => {
  it("reduces AGI by at most $3,000 on a large loss", () => {
    const noLoss = calculateTaxYear(baseInput());
    const loss = calculateTaxYear(baseInput({ longTermCapitalGains: -80_000 }));
    expect(noLoss.flow.adjustedGrossIncome - loss.flow.adjustedGrossIncome).toBe(3_000);
  });

  it("carries the unused loss forward as long-term", () => {
    const r = calculateTaxYear(baseInput({ longTermCapitalGains: -80_000 }));
    expect(r.capitalLoss.deduction).toBe(3_000);
    expect(r.capitalLoss.carryforwardOut.longTerm).toBe(77_000);
    expect(r.capitalLoss.carryforwardOut.shortTerm).toBe(0);
  });

  it("does NOT charge NIIT on gains a loss erased", () => {
    const r = calculateTaxYear(baseInput({
      earnedIncome: 300_000,
      longTermCapitalGains: 50_000,
      shortTermCapitalGains: -50_000,
    }));
    // Gains fully cross-netted to zero → no investment income → no NIIT.
    expect(r.flow.niit).toBe(0);
  });

  it("consumes prior-year carryforward against this year's gain", () => {
    const r = calculateTaxYear(baseInput({
      longTermCapitalGains: 20_000,
      capitalLossCarryforwardIn: { shortTerm: 0, longTerm: 50_000 },
    }));
    expect(r.income.capitalGains).toBe(0);          // gain fully sheltered
    expect(r.capitalLoss.deduction).toBe(3_000);
    expect(r.capitalLoss.carryforwardOut.longTerm).toBe(27_000);
  });

  it("an unabsorbed loss does not drive taxable income below zero", () => {
    const r = calculateTaxYear(baseInput({
      earnedIncome: 0, longTermCapitalGains: -80_000,
    }));
    expect(r.flow.taxableIncome).toBe(0);
    expect(r.flow.totalTax).toBe(0);
  });

  it("preserves the full carryforward when taxable income is zero", () => {
    const r = calculateTaxYear(baseInput({
      earnedIncome: 0, longTermCapitalGains: -80_000,
    }));
    expect(r.capitalLoss.deduction).toBe(3_000);
    expect(r.capitalLoss.carryforwardConsumed).toBe(0);
    expect(r.capitalLoss.carryforwardOut.longTerm).toBe(80_000);
  });

  it("is a no-op when there are no losses and no carryforward", () => {
    const r = calculateTaxYear(baseInput({ longTermCapitalGains: 40_000 }));
    expect(r.capitalLoss.deduction).toBe(0);
    expect(r.income.capitalGains).toBe(40_000);
  });
});
