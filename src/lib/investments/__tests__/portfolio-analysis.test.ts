import { describe, it, expect } from "vitest";
import { aggregateWeights } from "../portfolio-analysis";
import type { AccountAllocationResult } from "../allocation";

const classified = (rows: [string, number][]): AccountAllocationResult => ({
  classified: rows.map(([assetClassId, weight]) => ({ assetClassId, weight })),
});

describe("aggregateWeights", () => {
  it("value-weights two accounts and normalizes over classified dollars", () => {
    const out = aggregateWeights([
      { value: 100, result: classified([["eq", 1]]) },
      { value: 300, result: classified([["eq", 0.5], ["bond", 0.5]]) },
    ]);
    expect(out.totalValue).toBe(400);
    expect(out.residualUnallocatedPct).toBeCloseTo(0, 10);
    const eq = out.weights.find((w) => w.assetClassId === "eq")!;
    const bond = out.weights.find((w) => w.assetClassId === "bond")!;
    expect(eq.weight).toBeCloseTo(250 / 400, 10);
    expect(bond.weight).toBeCloseTo(150 / 400, 10);
  });

  it("treats unallocated accounts as residual, normalizing weights over classified only", () => {
    const out = aggregateWeights([
      { value: 100, result: classified([["eq", 1]]) },
      { value: 100, result: { unallocated: true } },
    ]);
    expect(out.totalValue).toBe(200);
    expect(out.residualUnallocatedPct).toBeCloseTo(0.5, 10);
    expect(out.weights).toEqual([{ assetClassId: "eq", weight: 1 }]);
  });

  it("returns empty weights and 100% residual when nothing is classified", () => {
    const out = aggregateWeights([{ value: 50, result: { unallocated: true } }]);
    expect(out.weights).toEqual([]);
    expect(out.residualUnallocatedPct).toBeCloseTo(1, 10);
  });

  it("treats partial account allocations (weights < 1) as residual dollars", () => {
    const out = aggregateWeights([{ value: 100, result: classified([["eq", 0.6]]) }]);
    expect(out.residualUnallocatedPct).toBeCloseTo(0.4, 10);
    expect(out.weights).toEqual([{ assetClassId: "eq", weight: 1 }]);
  });
});
