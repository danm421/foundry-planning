import { describe, it, expect } from "vitest";
import { capacityFactors } from "../capacity";
import {
  computeCapacityScore,
  CAPACITY_WEIGHTS,
  CAPACITY_RUNWAY_FULL_YEARS,
  CAPACITY_RETIREMENT_FULL_YEARS,
} from "@/lib/insights/risk-capacity";

const INPUTS = {
  yearsToRetirement: 25,
  retirementYears: 30,
  fundingScore: 0.95,
  withdrawalRate: 0.055,
  guaranteedIncomeCoverage: 0.35,
};

describe("capacityFactors", () => {
  it("returns the five weighted contributions", () => {
    const f = capacityFactors(INPUTS);
    expect(f.runway).toBeCloseTo(CAPACITY_WEIGHTS.runway * 1, 4);
    expect(f.retirementHorizon).toBeCloseTo(CAPACITY_WEIGHTS.retirementHorizon * 1, 4);
    expect(f.buffer).toBeCloseTo(CAPACITY_WEIGHTS.buffer * ((0.95 - 0.8) / 0.7), 4);
    expect(f.withdrawal).toBeCloseTo(CAPACITY_WEIGHTS.withdrawal * (1 - 0.055 / 0.06), 4);
    expect(f.incomeFloor).toBeCloseTo(CAPACITY_WEIGHTS.incomeFloor * 0.35, 4);
  });

  it("sums to the same score computeCapacityScore reports", () => {
    const f = capacityFactors(INPUTS);
    const sum =
      f.runway + f.incomeFloor + f.retirementHorizon + f.withdrawal + f.buffer;
    expect(Math.round(sum * 100)).toBe(computeCapacityScore(INPUTS));
  });

  it("checks each clock at a non-saturating value", () => {
    // INPUTS saturates both clocks, so a curve change (e.g. /20 -> /15, which
    // also still saturates at 25) would slip past the assertions above. Values
    // below each ceiling pin the factors to exact, non-saturated numbers so a
    // curve-shape change is caught here.
    const nonSaturating = {
      ...INPUTS,
      yearsToRetirement: 8,
      retirementYears: 10,
    };
    const f = capacityFactors(nonSaturating);
    expect(f.runway).toBeCloseTo(
      CAPACITY_WEIGHTS.runway * (8 / CAPACITY_RUNWAY_FULL_YEARS),
      4,
    );
    expect(f.retirementHorizon).toBeCloseTo(
      CAPACITY_WEIGHTS.retirementHorizon * (10 / CAPACITY_RETIREMENT_FULL_YEARS),
      4,
    );
    const sum =
      f.runway + f.incomeFloor + f.retirementHorizon + f.withdrawal + f.buffer;
    expect(Math.round(sum * 100)).toBe(computeCapacityScore(nonSaturating));
  });

  it("pins the two saturation points themselves, not just the curves", () => {
    // Both constants are referenced symbolically above, so moving one would
    // move its expectation with it. Assert the literals here.
    expect(CAPACITY_RUNWAY_FULL_YEARS).toBe(20);
    expect(CAPACITY_RETIREMENT_FULL_YEARS).toBe(25);
  });

  it("zeroes the runway for an already-retired household, keeping the rest", () => {
    // The whole point of splitting the clocks: retirement is not a cliff for
    // capacity, it just spends the first of the two.
    const retired = capacityFactors({ ...INPUTS, yearsToRetirement: 0 });
    expect(retired.runway).toBe(0);
    expect(retired.retirementHorizon).toBeCloseTo(CAPACITY_WEIGHTS.retirementHorizon, 6);
    expect(retired.incomeFloor).toBeGreaterThan(0);
  });

  it("clamps each factor to its own weight ceiling", () => {
    const f = capacityFactors({
      yearsToRetirement: 90,
      retirementYears: 90,
      fundingScore: 5,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 3,
    });
    expect(f.runway).toBeCloseTo(CAPACITY_WEIGHTS.runway, 6);
    expect(f.retirementHorizon).toBeCloseTo(CAPACITY_WEIGHTS.retirementHorizon, 6);
    expect(f.buffer).toBeCloseTo(CAPACITY_WEIGHTS.buffer, 6);
    expect(f.withdrawal).toBeCloseTo(CAPACITY_WEIGHTS.withdrawal, 6);
    expect(f.incomeFloor).toBeCloseTo(CAPACITY_WEIGHTS.incomeFloor, 6);
  });
});
