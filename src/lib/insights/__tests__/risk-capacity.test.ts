import { describe, it, expect } from "vitest";
import {
  computeCapacityScore,
  computeRequiredGrowthPct,
  solveRequiredReturn,
  impliedGrowthPct,
  CAPACITY_WEIGHTS,
  computeVerdict,
  assembleRiskAlignment,
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

  it("weights sum to 1.2 — deliberate headroom over the 100 cap", () => {
    const total =
      CAPACITY_WEIGHTS.horizon +
      CAPACITY_WEIGHTS.buffer +
      CAPACITY_WEIGHTS.withdrawal +
      CAPACITY_WEIGHTS.incomeFloor;
    expect(total).toBeCloseTo(1.2, 10);
  });

  it("caps at 100 rather than paying out the full 120", () => {
    const s = computeCapacityScore({
      horizonYears: 40,
      fundingScore: 1.6,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 1.2,
    });
    expect(s).toBe(100);
  });

  it("lets strength in three factors offset a missing income floor", () => {
    // The household this headroom exists for: very large portfolio, decades of
    // horizon, spending a rounding error against assets, and no Social Security
    // or pension worth counting. A zero income floor should not hold them at 80.
    const s = computeCapacityScore({
      horizonYears: 40,
      fundingScore: 1.6,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 0,
    });
    expect(s).toBe(95);
    // Under the old sum-to-1 weights this same household scored 80.
    expect(s).toBeGreaterThan(80);
  });

  it("still needs a fourth factor to actually reach 100", () => {
    // Three maxed factors reach 95, so the cap is not degenerate -- no single
    // factor is fully decorative.
    const threeMaxed = computeCapacityScore({
      horizonYears: 40,
      fundingScore: 1.6,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 0,
    });
    const withFloor = computeCapacityScore({
      horizonYears: 40,
      fundingScore: 1.6,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 0.2,
    });
    expect(threeMaxed).toBeLessThan(100);
    expect(withFloor).toBe(100);
  });

  it("is monotonic across the cap, never decreasing as an input improves", () => {
    const at = (coverage: number) =>
      computeCapacityScore({
        horizonYears: 40,
        fundingScore: 1.6,
        withdrawalRate: 0,
        guaranteedIncomeCoverage: coverage,
      });
    const series = [0, 0.1, 0.2, 0.5, 1, 1.5].map(at);
    for (let k = 1; k < series.length; k++) {
      expect(series[k]).toBeGreaterThanOrEqual(series[k - 1]);
    }
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

describe("computeVerdict", () => {
  it("aligned when current sits between required and capacity", () => {
    expect(computeVerdict({ currentPct: 55, requiredPct: 45, capacityPct: 60 })).toBe("aligned");
  });
  it("over_risked when current exceeds capacity beyond the band", () => {
    expect(computeVerdict({ currentPct: 78, requiredPct: 45, capacityPct: 60 })).toBe("over_risked");
  });
  it("under_risked when current is below required beyond the band", () => {
    expect(computeVerdict({ currentPct: 30, requiredPct: 45, capacityPct: 60 })).toBe("under_risked");
  });
  it("goals_over_reaching takes precedence when required exceeds capacity", () => {
    expect(computeVerdict({ currentPct: 90, requiredPct: 80, capacityPct: 55 })).toBe("goals_over_reaching");
  });
  it("respects the ±5 tolerance band (61 vs cap 60 is still aligned)", () => {
    expect(computeVerdict({ currentPct: 61, requiredPct: 45, capacityPct: 60 })).toBe("aligned");
  });
});

describe("assembleRiskAlignment", () => {
  it("produces all markers and a verdict", () => {
    const a = assembleRiskAlignment({
      currentPct: 78,
      capacity: { horizonYears: 20, fundingScore: 1.3, withdrawalRate: 0.03, guaranteedIncomeCoverage: 0.6 },
      required: {
        startingLiquidAssets: 800_000,
        avgAnnualRealNetWithdrawal: 30_000,
        horizonYears: 20,
        cashReturn: 0.02,
        equityReturn: 0.07,
      },
    });
    expect(a.currentPct).toBe(78);
    expect(a.capacityPct).toBe(a.capacityScore);
    expect(["aligned", "over_risked", "under_risked", "goals_over_reaching"]).toContain(a.verdict);
  });
});
