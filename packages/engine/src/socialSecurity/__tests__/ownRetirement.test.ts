import { describe, it, expect } from "vitest";
import { computeOwnMonthlyBenefit } from "../ownRetirement";

// Ground-truth checkpoints from SSA published numbers:
describe("computeOwnMonthlyBenefit — claim at FRA", () => {
  it("returns PIA when claim age equals FRA exactly", () => {
    // Born 1960-06-01 → FRA 67y 0m = 804 months. Claim at 67y 0m = 804.
    expect(computeOwnMonthlyBenefit({ piaMonthly: 2000, claimAgeMonths: 804, dob: "1960-06-01" }))
      .toBeCloseTo(2000, 2);
  });
});

describe("computeOwnMonthlyBenefit — early claim", () => {
  it("claim-62 with FRA-67 → PIA × 0.70", () => {
    // FRA 67y = 804m, claim 62y = 744m → 60 months early
    // first 36 × 5/9% = 0.2000; extended 24 × 5/12% = 0.1000; total 0.30
    expect(computeOwnMonthlyBenefit({ piaMonthly: 2000, claimAgeMonths: 744, dob: "1960-06-01" }))
      .toBeCloseTo(1400, 2);
  });
  it("claim-62 with FRA-66 → PIA × 0.75", () => {
    // Born 1950 → FRA 66y 0m = 792m. Claim 62y = 744m → 48 months early
    // first 36 × 5/9% = 0.2000; extended 12 × 5/12% = 0.0500; total 0.25
    expect(computeOwnMonthlyBenefit({ piaMonthly: 2000, claimAgeMonths: 744, dob: "1950-06-01" }))
      .toBeCloseTo(1500, 2);
  });
  it("fractional claim: claim-66y6m with FRA-67 → PIA × (1 − 6×5/9%) ≈ PIA × 0.9667", () => {
    // FRA 67y = 804m, claim 66y 6m = 798m → 6 months early
    expect(computeOwnMonthlyBenefit({ piaMonthly: 2000, claimAgeMonths: 798, dob: "1960-06-01" }))
      .toBeCloseTo(2000 * (1 - 6 * (5 / 900)), 2);
  });
});

describe("computeOwnMonthlyBenefit — delayed claim", () => {
  it("claim-70 with FRA-67 → PIA × 1.24", () => {
    // FRA 67y = 804m, claim 70y = 840m → 36 months late × 2/3% = 0.24
    expect(computeOwnMonthlyBenefit({ piaMonthly: 2000, claimAgeMonths: 840, dob: "1960-06-01" }))
      .toBeCloseTo(2480, 2);
  });
  it("claim-70 with FRA-66 → PIA × 1.32", () => {
    // FRA 66y = 792m, claim 70y = 840m → 48 months late × 2/3% = 0.32
    expect(computeOwnMonthlyBenefit({ piaMonthly: 2000, claimAgeMonths: 840, dob: "1950-06-01" }))
      .toBeCloseTo(2640, 2);
  });
  it("caps DRC at age 70 (claim beyond 70 gives no additional credit)", () => {
    // FRA 67y, claim 72y = 864m. Credit capped at 36 months (age 70)
    expect(computeOwnMonthlyBenefit({ piaMonthly: 2000, claimAgeMonths: 864, dob: "1960-06-01" }))
      .toBeCloseTo(2480, 2); // same as claim-70
  });
});

describe("computeOwnMonthlyBenefit — edge cases", () => {
  it("returns 0 when PIA is 0 regardless of claim age", () => {
    expect(computeOwnMonthlyBenefit({ piaMonthly: 0, claimAgeMonths: 804, dob: "1960-06-01" }))
      .toBe(0);
  });
});
