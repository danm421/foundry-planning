import { describe, it, expect } from "vitest";
import { buildProposalDonutSpec, buildProposalScatterSpec } from "../charts";

const MIX = [
  { assetClassId: "ac1", name: "US Large Cap", weight: 0.6 },
  { assetClassId: "ac2", name: "Core Bonds", weight: 0.3 },
  { assetClassId: "ac3", name: "Commodities", weight: 0.1 },
];

describe("buildProposalDonutSpec", () => {
  it("puts one segment per class on a single ring with fractions summing to 1", () => {
    const spec = buildProposalDonutSpec(MIX, "Proposed");
    expect(spec.kind).toBe("donut");
    expect(spec.rings).toHaveLength(1);
    expect(spec.rings[0].segments.map((s) => s.label)).toEqual([
      "US Large Cap", "Core Bonds", "Commodities",
    ]);
    const total = spec.rings[0].segments.reduce((s, x) => s + x.fraction, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(spec.centerLabel).toBe("Proposed");
  });

  it("gives each class a distinct color", () => {
    const colors = buildProposalDonutSpec(MIX, "Current").rings[0].segments.map((s) => s.color);
    expect(new Set(colors).size).toBe(3);
  });

  it("renders an empty mix as an empty ring rather than throwing", () => {
    const spec = buildProposalDonutSpec([], "Proposed");
    expect(spec.rings[0].segments).toEqual([]);
    expect(spec.legend).toEqual([]);
  });
});

describe("buildProposalScatterSpec", () => {
  const CURRENT = { arithmeticMean: 0.06, geometricReturn: 0.05, stdDev: 0.09, sharpe: 0.4 };
  const PROPOSED = { arithmeticMean: 0.08, geometricReturn: 0.066, stdDev: 0.154, sharpe: 0.68 };

  it("plots exactly two points labelled Current and Proposed", () => {
    const spec = buildProposalScatterSpec(CURRENT, PROPOSED);
    expect(spec.points.map((p) => p.label)).toEqual(["Current", "Proposed"]);
    expect(spec.legend.items.map((i) => i.label)).toEqual(["Current", "Proposed"]);
  });

  it("plots volatility on x and arithmetic mean on y", () => {
    const spec = buildProposalScatterSpec(CURRENT, PROPOSED);
    expect(spec.points[0].x).toBe(0.09);
    expect(spec.points[0].y).toBe(0.06);
    expect(spec.points[1].x).toBe(0.154);
    expect(spec.points[1].y).toBe(0.08);
  });

  it("gives the two points a domain that contains both", () => {
    const spec = buildProposalScatterSpec(CURRENT, PROPOSED);
    expect(spec.xAxis.domain[0]).toBeLessThanOrEqual(0.09);
    expect(spec.xAxis.domain[1]).toBeGreaterThanOrEqual(0.154);
    expect(spec.yAxis.domain[0]).toBeLessThanOrEqual(0.06);
    expect(spec.yAxis.domain[1]).toBeGreaterThanOrEqual(0.08);
  });
});
