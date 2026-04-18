import { describe, it, expect } from "vitest";
import { resolveBenchmark } from "../benchmarks";

const MODEL_PORTFOLIOS = [
  { id: "p1", name: "Conservative" },
  { id: "p2", name: "Aggressive" },
];

const ALLOCATIONS_BY_PORTFOLIO: Record<string, { assetClassId: string; weight: number }[]> = {
  p1: [
    { assetClassId: "ac-eq", weight: 0.4 },
    { assetClassId: "ac-bond", weight: 0.6 },
  ],
  p2: [
    { assetClassId: "ac-eq", weight: 0.8 },
    { assetClassId: "ac-intl", weight: 0.2 },
  ],
};

describe("resolveBenchmark", () => {
  it("returns the allocations of the matching portfolio", () => {
    const out = resolveBenchmark("p1", MODEL_PORTFOLIOS, ALLOCATIONS_BY_PORTFOLIO);
    expect(out).toEqual([
      { assetClassId: "ac-eq", weight: 0.4 },
      { assetClassId: "ac-bond", weight: 0.6 },
    ]);
  });

  it("returns null when the portfolio id is unknown", () => {
    const out = resolveBenchmark("missing", MODEL_PORTFOLIOS, ALLOCATIONS_BY_PORTFOLIO);
    expect(out).toBeNull();
  });

  it("returns null when the portfolio exists but has no allocations", () => {
    const out = resolveBenchmark("p1", MODEL_PORTFOLIOS, { p1: [], p2: ALLOCATIONS_BY_PORTFOLIO.p2! });
    expect(out).toBeNull();
  });

  it("returns null when the portfolio id is null / undefined", () => {
    expect(resolveBenchmark(null, MODEL_PORTFOLIOS, ALLOCATIONS_BY_PORTFOLIO)).toBeNull();
    expect(resolveBenchmark(undefined, MODEL_PORTFOLIOS, ALLOCATIONS_BY_PORTFOLIO)).toBeNull();
  });
});
