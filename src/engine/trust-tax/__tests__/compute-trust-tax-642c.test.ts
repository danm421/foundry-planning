import { describe, it, expect } from "vitest";
import { computeTrustTax } from "../compute-trust-tax";
import type { BracketTier } from "@/lib/tax/types";

const INCOME_BRACKETS: BracketTier[] = [
  { min: 0, rate: 0.1 },
  { min: 3_000, rate: 0.24 },
  { min: 11_000, rate: 0.35 },
  { min: 15_200, rate: 0.37 },
];
const CG_BRACKETS: BracketTier[] = [
  { min: 0, rate: 0 },
  { min: 3_150, rate: 0.15 },
  { min: 15_450, rate: 0.2 },
];

describe("computeTrustTax — §642(c) charitable deduction", () => {
  it("zeroes ordinary tax when deduction equals retained ordinary", () => {
    const result = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 100_000,
      retainedDividends: 0,
      recognizedCapGains: 0,
      trustIncomeBrackets: INCOME_BRACKETS,
      trustCapGainsBrackets: CG_BRACKETS,
      niitRate: 0.038,
      niitThreshold: 14_000,
      flatStateRate: 0,
      charitableDeduction: 100_000,
    });
    expect(result.federalOrdinaryTax).toBe(0);
    expect(result.retainedOrdinary).toBe(0);
    expect(result.niit).toBe(0);
    expect(result.total).toBe(0);
  });

  it("applies deduction sequentially: ordinary → dividends → cap gains", () => {
    const result = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 30_000,
      retainedDividends: 20_000,
      recognizedCapGains: 50_000,
      trustIncomeBrackets: INCOME_BRACKETS,
      trustCapGainsBrackets: CG_BRACKETS,
      niitRate: 0.038,
      niitThreshold: 14_000,
      flatStateRate: 0,
      charitableDeduction: 60_000, // exhausts ordinary + dividends, eats $10K cap gains
    });
    expect(result.retainedOrdinary).toBe(0);
    expect(result.retainedDividends).toBe(0);
    expect(result.recognizedCapGains).toBe(40_000);
  });

  it("does not generate a loss when deduction exceeds total income", () => {
    const result = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 10_000,
      retainedDividends: 5_000,
      recognizedCapGains: 5_000,
      trustIncomeBrackets: INCOME_BRACKETS,
      trustCapGainsBrackets: CG_BRACKETS,
      niitRate: 0.038,
      niitThreshold: 14_000,
      flatStateRate: 0,
      charitableDeduction: 100_000,
    });
    expect(result.retainedOrdinary).toBe(0);
    expect(result.retainedDividends).toBe(0);
    expect(result.recognizedCapGains).toBe(0);
    expect(result.total).toBe(0);
  });

  it("ignores deduction when not provided (no behavior change vs. baseline)", () => {
    const baseline = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 50_000,
      retainedDividends: 0,
      recognizedCapGains: 0,
      trustIncomeBrackets: INCOME_BRACKETS,
      trustCapGainsBrackets: CG_BRACKETS,
      niitRate: 0.038,
      niitThreshold: 14_000,
      flatStateRate: 0,
    });
    const withZeroDeduction = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 50_000,
      retainedDividends: 0,
      recognizedCapGains: 0,
      trustIncomeBrackets: INCOME_BRACKETS,
      trustCapGainsBrackets: CG_BRACKETS,
      niitRate: 0.038,
      niitThreshold: 14_000,
      flatStateRate: 0,
      charitableDeduction: 0,
    });
    expect(baseline.total).toBe(withZeroDeduction.total);
  });
});
