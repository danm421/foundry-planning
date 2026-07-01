import { describe, it, expect } from "vitest";
import { buildStatsContext, computeStats } from "../portfolio-stats";
import type { AssetClassData } from "@/lib/portfolio-math";

const AC = (id: string, mean: number, vol: number): AssetClassData => ({
  id, arithmeticMean: mean, geometricReturn: mean - (vol * vol) / 2, volatility: vol,
  pctOrdinaryIncome: 0, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0,
});

describe("computeStats", () => {
  const classes = [AC("eq", 0.09, 0.16), AC("bond", 0.04, 0.05)];

  it("returns a single asset class's own mean and vol", () => {
    const ctx = buildStatsContext(classes, [], 0.02);
    const s = computeStats([{ assetClassId: "eq", weight: 1 }], ctx);
    expect(s.arithmeticMean).toBeCloseTo(0.09, 10);
    expect(s.stdDev).toBeCloseTo(0.16, 10);
    expect(s.geometricReturn).toBeCloseTo(0.09 - 0.16 ** 2 / 2, 10);
    expect(s.sharpe).toBeCloseTo((0.09 - 0.02) / 0.16, 10);
  });

  it("blends mean linearly and applies correlation to variance (golden 60/40, rho=0.2)", () => {
    const ctx = buildStatsContext(classes, [
      { assetClassIdA: "bond", assetClassIdB: "eq", correlation: 0.2 },
    ], 0.02);
    const w = [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bond", weight: 0.4 }];
    const s = computeStats(w, ctx);
    expect(s.arithmeticMean).toBeCloseTo(0.07, 10);
    expect(s.stdDev).toBeCloseTo(Math.sqrt(0.010384), 10);
  });

  it("geometric return is the naive weighted average of per-class geo returns (eMoney parity)", () => {
    const ctx = buildStatsContext(classes, [
      { assetClassIdA: "bond", assetClassIdB: "eq", correlation: 0.2 },
    ], 0.02);
    const w = [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bond", weight: 0.4 }];
    const s = computeStats(w, ctx);
    // eq.geo = 0.09 − 0.16²/2 = 0.0772 ; bond.geo = 0.04 − 0.05²/2 = 0.03875
    // naive = 0.6·0.0772 + 0.4·0.03875 = 0.06182  (NOT the diversified arith − stdDev²/2)
    expect(s.geometricReturn).toBeCloseTo(0.06182, 10);
    // std dev stays diversified (unchanged):
    expect(s.stdDev).toBeCloseTo(Math.sqrt(0.010384), 10);
  });

  it("returns null Sharpe when stdDev is 0", () => {
    const ctx = buildStatsContext([AC("cashlike", 0.02, 0)], [], 0.02);
    const s = computeStats([{ assetClassId: "cashlike", weight: 1 }], ctx);
    expect(s.stdDev).toBe(0);
    expect(s.sharpe).toBeNull();
  });

  it("ignores weights for unknown asset class ids", () => {
    const ctx = buildStatsContext(classes, [], 0.02);
    const s = computeStats([{ assetClassId: "eq", weight: 1 }, { assetClassId: "ghost", weight: 1 }], ctx);
    expect(s.arithmeticMean).toBeCloseTo(0.09, 10);
  });
});
