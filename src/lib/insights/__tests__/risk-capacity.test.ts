import { describe, it, expect } from "vitest";
import {
  computeCapacityScore,
  computeRequiredGrowthPct,
  solveRequiredReturn,
  impliedGrowthPct,
  CAPACITY_WEIGHTS,
} from "../risk-capacity";

describe("computeCapacityScore", () => {
  it("returns ~100 for a long horizon, big surplus, no withdrawals, fully floored", () => {
    const s = computeCapacityScore({
      horizonYears: 40,
      fundingScore: 1.6,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 1.2,
    });
    expect(s).toBeGreaterThan(95);
  });

  it("returns ~0 for short horizon, underfunded, heavy withdrawals, no floor", () => {
    const s = computeCapacityScore({
      horizonYears: 0,
      fundingScore: 0.8,
      withdrawalRate: 0.06,
      guaranteedIncomeCoverage: 0,
    });
    expect(s).toBeLessThan(5);
  });

  it("weights sum to 1", () => {
    const total =
      CAPACITY_WEIGHTS.horizon +
      CAPACITY_WEIGHTS.buffer +
      CAPACITY_WEIGHTS.withdrawal +
      CAPACITY_WEIGHTS.incomeFloor;
    expect(total).toBeCloseTo(1, 10);
  });

  it("is monotonic in funding buffer", () => {
    const base = { horizonYears: 20, withdrawalRate: 0.03, guaranteedIncomeCoverage: 0.5 };
    const lo = computeCapacityScore({ ...base, fundingScore: 1.0 });
    const hi = computeCapacityScore({ ...base, fundingScore: 1.5 });
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("solveRequiredReturn", () => {
  it("returns near 0 (or negative) when assets already exceed total withdrawals", () => {
    // A = 1,000,000; W = 20,000/yr for 30 yrs = 600k undiscounted → no growth needed
    const r = solveRequiredReturn(1_000_000, 20_000, 30);
    expect(r).toBeLessThan(0.02);
  });

  it("requires a high return when withdrawals dwarf assets", () => {
    // A = 500,000; W = 60,000/yr for 30 yrs → needs meaningful growth
    const r = solveRequiredReturn(500_000, 60_000, 30);
    expect(r).toBeGreaterThan(0.09);
  });

  it("returns a very low number when there are no withdrawals", () => {
    const r = solveRequiredReturn(500_000, 0, 30);
    expect(r).toBeLessThan(0);
  });
});

describe("impliedGrowthPct", () => {
  it("maps a required return between cash and equity onto 0..100", () => {
    // cash 2%, equity 7%, required 4.5% → halfway → ~50
    expect(impliedGrowthPct(0.045, 0.02, 0.07)).toBeCloseTo(50, 0);
  });
  it("clamps below cash to 0 and above equity to 100", () => {
    expect(impliedGrowthPct(0.0, 0.02, 0.07)).toBe(0);
    expect(impliedGrowthPct(0.20, 0.02, 0.07)).toBe(100);
  });
});

describe("computeRequiredGrowthPct", () => {
  it("is 0 when the plan self-funds (no withdrawals)", () => {
    const pct = computeRequiredGrowthPct({
      startingLiquidAssets: 500_000,
      avgAnnualRealNetWithdrawal: 0,
      horizonYears: 30,
      cashReturn: 0.02,
      equityReturn: 0.07,
    });
    expect(pct).toBe(0);
  });
  it("is 100 when withdrawals demand more than equity can deliver", () => {
    const pct = computeRequiredGrowthPct({
      startingLiquidAssets: 300_000,
      avgAnnualRealNetWithdrawal: 80_000,
      horizonYears: 30,
      cashReturn: 0.02,
      equityReturn: 0.07,
    });
    expect(pct).toBe(100);
  });
});
