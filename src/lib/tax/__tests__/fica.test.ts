import { describe, it, expect } from "vitest";
import { calcFica, calcAdditionalMedicare } from "../fica";

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
