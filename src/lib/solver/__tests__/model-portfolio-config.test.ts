import { describe, it, expect } from "vitest";
import {
  growthAndRealizationFromPortfolio,
  mixFromAllocationRows,
  assembleSolverPortfolios,
} from "../model-portfolio-config";

describe("growthAndRealizationFromPortfolio", () => {
  it("maps ResolvedGrowth to a taxable account growthRate + realization (turnover 0)", () => {
    const out = growthAndRealizationFromPortfolio({
      geoReturn: 0.062,
      pctOi: 0.1,
      pctLtcg: 0.7,
      pctQdiv: 0.15,
      pctTaxEx: 0.05,
    });
    expect(out.growthRate).toBeCloseTo(0.062, 6);
    expect(out.realization).toEqual({
      pctOrdinaryIncome: 0.1,
      pctLtCapitalGains: 0.7,
      pctQualifiedDividends: 0.15,
      pctTaxExempt: 0.05,
      turnoverPct: 0,
    });
  });
});

describe("mixFromAllocationRows", () => {
  it("parses string weights into AccountAssetMix[]", () => {
    expect(
      mixFromAllocationRows([
        { assetClassId: "ac-1", weight: "0.6000" },
        { assetClassId: "ac-2", weight: "0.4000" },
      ]),
    ).toEqual([
      { assetClassId: "ac-1", weight: 0.6 },
      { assetClassId: "ac-2", weight: 0.4 },
    ]);
  });
});

describe("assembleSolverPortfolios", () => {
  it("falls back to [] mix when portfolio id is absent from allocsByPortfolio", () => {
    const out = assembleSolverPortfolios(
      [{ id: "p-unknown", name: "Orphan" }],
      new Map(), // no entry for "p-unknown"
      (_id) => ({ geoReturn: 0.04, pctOi: 0, pctLtcg: 1, pctQdiv: 0, pctTaxEx: 0 }),
    );
    expect(out[0].mix).toEqual([]);
  });

  it("joins names, resolved growth, and per-portfolio mix", () => {
    const out = assembleSolverPortfolios(
      [{ id: "p1", name: "Balanced 60/40" }],
      new Map([["p1", [{ assetClassId: "ac-1", weight: "1.0000" }]]]),
      (id) => (id === "p1"
        ? { geoReturn: 0.05, pctOi: 0, pctLtcg: 0.85, pctQdiv: 0.15, pctTaxEx: 0 }
        : { geoReturn: 0, pctOi: 0, pctLtcg: 0, pctQdiv: 0, pctTaxEx: 0 }),
    );
    expect(out).toEqual([
      {
        id: "p1",
        name: "Balanced 60/40",
        growthRate: 0.05,
        realization: {
          pctOrdinaryIncome: 0,
          pctLtCapitalGains: 0.85,
          pctQualifiedDividends: 0.15,
          pctTaxExempt: 0,
          turnoverPct: 0,
        },
        mix: [{ assetClassId: "ac-1", weight: 1 }],
      },
    ]);
  });
});
