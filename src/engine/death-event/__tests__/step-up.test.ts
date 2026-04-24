import { describe, it, expect } from "vitest";
import { computeSteppedUpBasis } from "../shared";

describe("computeSteppedUpBasis", () => {
  const noJoint = { isJointAtFirstDeath: false };
  const joint = { isJointAtFirstDeath: true };

  it("taxable, single-owner → returns FMV", () => {
    expect(computeSteppedUpBasis("taxable", 500_000, 200_000, noJoint)).toBe(500_000);
  });

  it("real_estate, single-owner → returns FMV", () => {
    expect(computeSteppedUpBasis("real_estate", 1_200_000, 600_000, noJoint)).toBe(1_200_000);
  });

  it("business, single-owner → returns FMV", () => {
    expect(computeSteppedUpBasis("business", 3_000_000, 500_000, noJoint)).toBe(3_000_000);
  });

  it("cash, single-owner → returns FMV (idempotent: cash basis equals value)", () => {
    expect(computeSteppedUpBasis("cash", 100_000, 100_000, noJoint)).toBe(100_000);
  });

  it("retirement, single-owner → returns originalBasis unchanged (IRD rule)", () => {
    expect(computeSteppedUpBasis("retirement", 600_000, 50_000, noJoint)).toBe(50_000);
  });

  it("life_insurance → returns originalBasis unchanged", () => {
    expect(computeSteppedUpBasis("life_insurance", 500_000, 0, noJoint)).toBe(0);
  });

  it("taxable, joint-at-first-death → returns (FMV + basis) / 2", () => {
    expect(computeSteppedUpBasis("taxable", 500_000, 200_000, joint)).toBe(350_000);
  });

  it("real_estate, joint-at-first-death → returns (FMV + basis) / 2", () => {
    expect(computeSteppedUpBasis("real_estate", 800_000, 300_000, joint)).toBe(550_000);
  });

  it("retirement, joint-at-first-death → returns originalBasis (IRD rule wins over joint rule)", () => {
    expect(computeSteppedUpBasis("retirement", 400_000, 0, joint)).toBe(0);
  });

  it("FMV < originalBasis (depreciated) → returns FMV (§1014 allows step-down)", () => {
    expect(computeSteppedUpBasis("taxable", 100_000, 300_000, noJoint)).toBe(100_000);
  });

  it("FMV < originalBasis + joint → returns half-step-down to (FMV + basis) / 2", () => {
    // Not a step-down per se — both halves get averaged. Survivor half keeps
    // their $150k portion, decedent half resets to FMV $50k. Total $200k.
    expect(computeSteppedUpBasis("taxable", 100_000, 300_000, joint)).toBe(200_000);
  });
});
