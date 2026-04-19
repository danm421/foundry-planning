import { describe, it, expect } from "vitest";
import { computeSurvivorMonthlyBenefit } from "../survivor";

// All tests use deceased DOB "1950-06-01" (FRA 66y 0m = 792m) unless noted.
// Survivor DOB "1952-06-01" (survivor FRA 66y 0m = 792m, monthlyReductionPct ≈ 0.003958).

describe("computeSurvivorMonthlyBenefit — Case A (deceased filed BEFORE FRA)", () => {
  it("max survivor = max(reduced benefit, 82.5% of PIA) — floor wins", () => {
    // Deceased: PIA 2000, filed at 62 → reduced = 2000 × 0.75 = 1500
    // Floor = 0.825 × 2000 = 1650 → max survivor = 1650
    // Survivor claims at survivor-FRA → no reduction → 1650
    expect(computeSurvivorMonthlyBenefit({
      deceasedPiaMonthly: 2000,
      deceasedFiledBeforeFra: true,
      deceasedReducedBenefit: 1500,
      deceasedNeverFiled: false,
      deceasedDrcMonths: 0,
      survivorAgeMonths: 792,
      survivorDob: "1952-06-01",
    })).toBeCloseTo(1650, 2);
  });
  it("max survivor = reduced when floor doesn't apply", () => {
    // Deceased: PIA 2000, filed at 65 → reduced = 2000 × (1 - 24 × 5/9%) ≈ 1733.33
    // Floor = 1650, reduced = 1733.33 → max = 1733.33
    expect(computeSurvivorMonthlyBenefit({
      deceasedPiaMonthly: 2000,
      deceasedFiledBeforeFra: true,
      deceasedReducedBenefit: 1733.33,
      deceasedNeverFiled: false,
      deceasedDrcMonths: 0,
      survivorAgeMonths: 792,
      survivorDob: "1952-06-01",
    })).toBeCloseTo(1733.33, 2);
  });
});

describe("computeSurvivorMonthlyBenefit — Case B (deceased filed AT/AFTER FRA)", () => {
  it("survivor gets 100% of deceased's benefit (including DRC)", () => {
    // Deceased filed at 70, benefit 2480 (PIA 2000 × 1.24)
    expect(computeSurvivorMonthlyBenefit({
      deceasedPiaMonthly: 2000,
      deceasedFiledBeforeFra: false,
      deceasedReducedBenefit: 2480,
      deceasedNeverFiled: false,
      deceasedDrcMonths: 36,
      survivorAgeMonths: 792,
      survivorDob: "1952-06-01",
    })).toBeCloseTo(2480, 2);
  });
});

describe("computeSurvivorMonthlyBenefit — Case C (died BEFORE FRA, never filed)", () => {
  it("survivor max = 100% of PIA", () => {
    expect(computeSurvivorMonthlyBenefit({
      deceasedPiaMonthly: 2000,
      deceasedFiledBeforeFra: false,
      deceasedReducedBenefit: 0,
      deceasedNeverFiled: true,
      deceasedDrcMonths: 0,
      survivorAgeMonths: 792,
      survivorDob: "1952-06-01",
    })).toBeCloseTo(2000, 2);
  });
});

describe("computeSurvivorMonthlyBenefit — Case D (died AT/AFTER FRA, never filed)", () => {
  it("survivor max = PIA × (1 + monthsPastFRA × 2/3%)", () => {
    // Deceased died 12 months past FRA (age 67) → DRC = 12 × 2/3% = 0.08
    // Max = 2000 × 1.08 = 2160
    expect(computeSurvivorMonthlyBenefit({
      deceasedPiaMonthly: 2000,
      deceasedFiledBeforeFra: false,
      deceasedReducedBenefit: 0,
      deceasedNeverFiled: true,
      deceasedDrcMonths: 12,
      survivorAgeMonths: 792,
      survivorDob: "1952-06-01",
    })).toBeCloseTo(2160, 2);
  });
});

describe("computeSurvivorMonthlyBenefit — early survivor reduction", () => {
  it("claim at age 60 with survivor-FRA 66 → maxSurvivor × 0.715", () => {
    // Case B: deceased filed at FRA, benefit 2000. Max = 2000.
    // Survivor at 60 = 720 months, survivor-FRA 792 → 72 months early
    // Reduction = 72 × (0.285 / 72) = 0.285 → survivor gets 2000 × 0.715 = 1430
    expect(computeSurvivorMonthlyBenefit({
      deceasedPiaMonthly: 2000,
      deceasedFiledBeforeFra: false,
      deceasedReducedBenefit: 2000,
      deceasedNeverFiled: false,
      deceasedDrcMonths: 0,
      survivorAgeMonths: 720,
      survivorDob: "1952-06-01",
    })).toBeCloseTo(1430, 2);
  });
  it("claim at survivor-FRA exactly → no reduction", () => {
    expect(computeSurvivorMonthlyBenefit({
      deceasedPiaMonthly: 2000,
      deceasedFiledBeforeFra: false,
      deceasedReducedBenefit: 2000,
      deceasedNeverFiled: false,
      deceasedDrcMonths: 0,
      survivorAgeMonths: 792,
      survivorDob: "1952-06-01",
    })).toBeCloseTo(2000, 2);
  });
});
