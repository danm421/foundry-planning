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

/** An unremarkable plan: on the funded boundary, ordinary draw, partial SS. */
const ORDINARY = {
  fundingScore: 1.0,
  withdrawalRate: 0.04,
  guaranteedIncomeCoverage: 0.35,
};

describe("computeCapacityScore", () => {
  it("returns ~100 for both clocks long, big surplus, no withdrawals, fully floored", () => {
    const s = computeCapacityScore({
      yearsToRetirement: 25,
      retirementYears: 30,
      fundingScore: 1.6,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 1.2,
    });
    expect(s).toBeGreaterThan(95);
  });

  it("returns ~0 with no runway, no retirement left, underfunded, no floor", () => {
    const s = computeCapacityScore({
      yearsToRetirement: 0,
      retirementYears: 0,
      fundingScore: 0.8,
      withdrawalRate: 0.06,
      guaranteedIncomeCoverage: 0,
    });
    expect(s).toBeLessThan(5);
  });

  it("weights sum to 1.43 — deliberate headroom over the 100 cap", () => {
    const total = Object.values(CAPACITY_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1.43, 10);
  });

  it("makes runway and the income floor the two heavyweights", () => {
    // Near-parity is the design: they are substitutes, not a ranking.
    const supporting =
      CAPACITY_WEIGHTS.retirementHorizon +
      CAPACITY_WEIGHTS.withdrawal +
      CAPACITY_WEIGHTS.buffer;
    expect(CAPACITY_WEIGHTS.runway).toBeGreaterThan(supporting);
    expect(CAPACITY_WEIGHTS.incomeFloor).toBeGreaterThan(supporting);
    expect(
      Math.abs(CAPACITY_WEIGHTS.runway - CAPACITY_WEIGHTS.incomeFloor),
    ).toBeLessThanOrEqual(0.1);
  });

  it("caps at 100 rather than paying out the full 143", () => {
    const s = computeCapacityScore({
      yearsToRetirement: 25,
      retirementYears: 30,
      fundingScore: 1.6,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 1.2,
    });
    expect(s).toBe(100);
  });

  it("route 1: 20+ years to retirement carries an ordinary plan to ~90", () => {
    const s = computeCapacityScore({
      yearsToRetirement: 25,
      retirementYears: 30,
      ...ORDINARY,
    });
    expect(s).toBeGreaterThanOrEqual(88);
  });

  it("route 2: a full income floor carries a RETIRED household to ~90", () => {
    // No runway at all. Spending is entirely covered by Social Security and a
    // pension, so the portfolio is discretionary and never has to be sold into
    // a drawdown. Age must not be able to veto that.
    const s = computeCapacityScore({
      yearsToRetirement: 0,
      retirementYears: 25,
      fundingScore: 1.5,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 1.0,
    });
    expect(s).toBeGreaterThanOrEqual(88);
  });

  it("keeps route 2 high even on an unremarkable funding buffer", () => {
    // Same fully-floored retiree, but only a middling buffer -- the floor has
    // to carry them on its own, which is the whole claim.
    const s = computeCapacityScore({
      yearsToRetirement: 0,
      retirementYears: 25,
      fundingScore: 1.0,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 1.0,
    });
    expect(s).toBeGreaterThanOrEqual(80);
  });

  it("scores 20 years to retirement far above 7, holding the plan constant", () => {
    // The headline defect in the old single-horizon model: both of these
    // households had ~35 years to plan end, so both scored identically on
    // time. They are not in the same situation.
    const far = computeCapacityScore({
      yearsToRetirement: 20,
      retirementYears: 30,
      ...ORDINARY,
    });
    const near = computeCapacityScore({
      yearsToRetirement: 7,
      retirementYears: 30,
      ...ORDINARY,
    });
    expect(far - near).toBeGreaterThan(25);
  });

  it("does not let the three supporting factors manufacture capacity", () => {
    // Maxed retirement horizon, zero withdrawals, huge surplus -- but the
    // money is needed now and nothing is guaranteed. That is not capacity.
    const s = computeCapacityScore({
      yearsToRetirement: 0,
      retirementYears: 30,
      fundingScore: 1.6,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 0,
    });
    expect(s).toBeLessThanOrEqual(45);
  });

  it("keeps a retired household off the floor purely on years remaining", () => {
    // The second clock's job: a 66-year-old and an 88-year-old differ, even
    // with the first clock spent and the same plan behind them.
    const early = computeCapacityScore({
      yearsToRetirement: 0,
      retirementYears: 30,
      ...ORDINARY,
    });
    const late = computeCapacityScore({
      yearsToRetirement: 0,
      retirementYears: 5,
      ...ORDINARY,
    });
    expect(early).toBeGreaterThan(late);
  });

  it("lets a maxed runway offset a missing income floor entirely", () => {
    // The household this headroom exists for: very large portfolio, decades
    // before it is touched, spending a rounding error against assets, and no
    // Social Security or pension worth counting. A zero income floor -- the
    // other route -- should not hold them down.
    const s = computeCapacityScore({
      yearsToRetirement: 25,
      retirementYears: 30,
      fundingScore: 1.6,
      withdrawalRate: 0,
      guaranteedIncomeCoverage: 0,
    });
    expect(s).toBe(95);
    // Under the original sum-to-1 weights this same household scored 80.
    expect(s).toBeGreaterThan(80);
  });

  it("needs more than the two heavyweights alone to reach 100", () => {
    // The cap is not degenerate: runway + income floor maxed with all three
    // supporting factors at rock bottom stops short, so nothing is decorative.
    const bothRoutes = computeCapacityScore({
      yearsToRetirement: 20,
      retirementYears: 0,
      fundingScore: 0.8,
      withdrawalRate: 0.06,
      guaranteedIncomeCoverage: 1.0,
    });
    expect(bothRoutes).toBeLessThan(100);
    expect(bothRoutes).toBe(98);
  });

  it("is monotonic across the cap, never decreasing as an input improves", () => {
    const at = (coverage: number) =>
      computeCapacityScore({
        yearsToRetirement: 20,
        retirementYears: 25,
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
    const base = {
      yearsToRetirement: 10,
      retirementYears: 25,
      withdrawalRate: 0.03,
      guaranteedIncomeCoverage: 0.5,
    };
    const lo = computeCapacityScore({ ...base, fundingScore: 1.0 });
    const hi = computeCapacityScore({ ...base, fundingScore: 1.5 });
    expect(hi).toBeGreaterThan(lo);
  });

  it("is monotonic in each clock independently", () => {
    const base = { ...ORDINARY, yearsToRetirement: 8, retirementYears: 12 };
    expect(
      computeCapacityScore({ ...base, yearsToRetirement: 15 }),
    ).toBeGreaterThan(computeCapacityScore(base));
    expect(
      computeCapacityScore({ ...base, retirementYears: 22 }),
    ).toBeGreaterThan(computeCapacityScore(base));
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
      capacity: {
        yearsToRetirement: 10,
        retirementYears: 20,
        fundingScore: 1.3,
        withdrawalRate: 0.03,
        guaranteedIncomeCoverage: 0.6,
      },
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
