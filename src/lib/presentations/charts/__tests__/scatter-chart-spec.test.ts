import { describe, it, expect } from "vitest";
import { snapPercentDomain, buildScatterSpec } from "../scatter-chart-spec";
import type { AnalysisRow } from "@/lib/investments/portfolio-analysis";

describe("snapPercentDomain", () => {
  it("snaps to whole percents with -4pp low / +1pp high padding", () => {
    expect(snapPercentDomain([0.071, 0.123])).toEqual([0.03, 0.14]);
  });
  it("handles a single value", () => {
    const [lo, hi] = snapPercentDomain([0.05]);
    expect(lo).toBeLessThan(0.05);
    expect(hi).toBeGreaterThan(0.05);
  });
});

describe("buildScatterSpec", () => {
  // AnalysisRow: { key, type, id, name, weights, value, residualUnallocatedPct, stats, sortOrder?, assetType? }
  const rows: AnalysisRow[] = [
    {
      key: "asset_class:eq",
      type: "asset_class",
      id: "eq",
      name: "US Equity",
      weights: [],
      value: null,
      residualUnallocatedPct: 0,
      sortOrder: 0,
      assetType: "equities",
      stats: { arithmeticMean: 0.08, geometricReturn: 0.07, stdDev: 0.16, sharpe: 0.3 },
    },
    {
      key: "account:a1",
      type: "account",
      id: "a1",
      name: "Brokerage",
      weights: [],
      value: 100,
      residualUnallocatedPct: 0,
      stats: { arithmeticMean: 0.06, geometricReturn: 0.055, stdDev: 0.1, sharpe: 0.3 },
    },
  ];

  it("maps rows to points with x=stdDev y=mean and per-series style", () => {
    const spec = buildScatterSpec(rows);
    expect(spec.points).toHaveLength(2);
    const eq = spec.points.find((p) => p.key === "asset_class:eq")!;
    expect(eq.x).toBeCloseTo(0.16);
    expect(eq.y).toBeCloseTo(0.08);
    expect(eq.pointStyle).toBe("circle");
  });

  it("builds one legend item per series type present", () => {
    const spec = buildScatterSpec(rows);
    expect(spec.legend.items.map((i) => i.label).sort()).toEqual(["Accounts", "Asset Classes"]);
  });
});
