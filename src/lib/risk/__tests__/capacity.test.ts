import { describe, it, expect } from "vitest";
import { capacityFactors } from "../capacity";
import { computeCapacityScore, CAPACITY_WEIGHTS } from "@/lib/insights/risk-capacity";

const INPUTS = {
  horizonYears: 33,
  fundingScore: 0.95,
  withdrawalRate: 0.055,
  guaranteedIncomeCoverage: 0.35,
};

describe("capacityFactors", () => {
  it("returns the four weighted contributions", () => {
    const f = capacityFactors(INPUTS);
    expect(f.horizon).toBeCloseTo(CAPACITY_WEIGHTS.horizon * 1, 4);
    expect(f.buffer).toBeCloseTo(CAPACITY_WEIGHTS.buffer * ((0.95 - 0.8) / 0.7), 4);
    expect(f.withdrawal).toBeCloseTo(CAPACITY_WEIGHTS.withdrawal * (1 - 0.055 / 0.06), 4);
    expect(f.incomeFloor).toBeCloseTo(CAPACITY_WEIGHTS.incomeFloor * 0.35, 4);
  });

  it("sums to the same score computeCapacityScore reports", () => {
    const f = capacityFactors(INPUTS);
    const sum = f.horizon + f.buffer + f.withdrawal + f.incomeFloor;
    expect(Math.round(sum * 100)).toBe(computeCapacityScore(INPUTS));
  });

  it("clamps each factor to its own weight ceiling", () => {
    const f = capacityFactors({
      horizonYears: 90,
      fundingScore: 5,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 3,
    });
    expect(f.horizon).toBeCloseTo(CAPACITY_WEIGHTS.horizon, 6);
    expect(f.buffer).toBeCloseTo(CAPACITY_WEIGHTS.buffer, 6);
    expect(f.withdrawal).toBeCloseTo(CAPACITY_WEIGHTS.withdrawal, 6);
    expect(f.incomeFloor).toBeCloseTo(CAPACITY_WEIGHTS.incomeFloor, 6);
  });
});
