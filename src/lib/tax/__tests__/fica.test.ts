import { describe, it, expect } from "vitest";
import { calcFica, calcAdditionalMedicare, calcSeAdditionalMedicare } from "../fica";

describe("calcFica", () => {
  it("returns 0 for no earned income", () => {
    expect(calcFica({ earnedIncome: 0, ssTaxRate: 0.062, ssWageBase: 184500, medicareTaxRate: 0.0145 })).toEqual({ ssTax: 0, medicareTax: 0, total: 0 });
  });

  it("applies SS + Medicare under wage base", () => {
    const r = calcFica({ earnedIncome: 100000, ssTaxRate: 0.062, ssWageBase: 184500, medicareTaxRate: 0.0145 });
    expect(r.ssTax).toBeCloseTo(6200, 2);
    expect(r.medicareTax).toBeCloseTo(1450, 2);
    expect(r.total).toBeCloseTo(7650, 2);
  });

  it("caps SS at wage base, Medicare keeps going", () => {
    const r = calcFica({ earnedIncome: 250000, ssTaxRate: 0.062, ssWageBase: 184500, medicareTaxRate: 0.0145 });
    expect(r.ssTax).toBeCloseTo(11439, 2);
    expect(r.medicareTax).toBeCloseTo(3625, 2);
  });
});

describe("calcAdditionalMedicare", () => {
  it("returns 0 below threshold", () => {
    expect(calcAdditionalMedicare({ earnedIncome: 200000, threshold: 250000, rate: 0.009 })).toBe(0);
  });

  it("returns 0.9% × excess above threshold", () => {
    expect(calcAdditionalMedicare({ earnedIncome: 300000, threshold: 250000, rate: 0.009 })).toBeCloseTo(450, 2);
  });

  it("single threshold ($200k) gives different result", () => {
    expect(calcAdditionalMedicare({ earnedIncome: 250000, threshold: 200000, rate: 0.009 })).toBeCloseTo(450, 2);
  });
});

describe("calcSeAdditionalMedicare", () => {
  it("returns 0 when there are no SE earnings", () => {
    expect(
      calcSeAdditionalMedicare({ seEarnings: 0, ficaSsWages: 0, threshold: 200000, rate: 0.009 }),
    ).toBe(0);
  });

  it("BUG #18: single filer, $0 wages, $400k SE earnings → 0.9% on wage-reduced SE base", () => {
    // 0.009 * max(0, 0.9235*400000 − max(0, 200000 − 0))
    // = 0.009 * (369400 − 200000) = 0.009 * 169400 = 1524.60
    expect(
      calcSeAdditionalMedicare({ seEarnings: 400000, ficaSsWages: 0, threshold: 200000, rate: 0.009 }),
    ).toBeCloseTo(1524.6, 2);
  });

  it("returns 0 when 92.35% SE base sits below the (wage-reduced) threshold", () => {
    // 0.9235*150000 = 138525 < 200000
    expect(
      calcSeAdditionalMedicare({ seEarnings: 150000, ficaSsWages: 0, threshold: 200000, rate: 0.009 }),
    ).toBe(0);
  });

  it("wages consume the threshold first; SE base is reduced by only the remaining threshold", () => {
    // wages 120000, threshold 200000 → remaining threshold = 80000
    // SE base subject = max(0, 0.9235*300000 − 80000) = 277050 − 80000 = 197050
    // surtax = 0.009 * 197050 = 1773.45
    expect(
      calcSeAdditionalMedicare({ seEarnings: 300000, ficaSsWages: 120000, threshold: 200000, rate: 0.009 }),
    ).toBeCloseTo(1773.45, 2);
  });

  it("wages alone above threshold → SE base faces no threshold reduction (full 0.9% on 92.35% SE)", () => {
    // wages 250000 ≥ threshold 200000 → remaining threshold = 0
    // SE base subject = 0.9235*100000 = 92350; surtax = 0.009*92350 = 831.15
    expect(
      calcSeAdditionalMedicare({ seEarnings: 100000, ficaSsWages: 250000, threshold: 200000, rate: 0.009 }),
    ).toBeCloseTo(831.15, 2);
  });
});
