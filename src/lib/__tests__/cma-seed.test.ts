import { describe, it, expect } from "vitest";
import { DEFAULT_ASSET_CLASSES, DEFAULT_MODEL_PORTFOLIOS } from "../cma-seed";

describe("CMA seed data", () => {
  it("provides 15 default asset classes", () => {
    expect(DEFAULT_ASSET_CLASSES).toHaveLength(15);
  });

  it("each asset class realization percentages sum to 1", () => {
    for (const ac of DEFAULT_ASSET_CLASSES) {
      const sum = ac.pctOrdinaryIncome + ac.pctLtCapitalGains + ac.pctQualifiedDividends + ac.pctTaxExempt;
      expect(sum).toBeCloseTo(1.0, 4);
    }
  });

  it("provides 4 default model portfolios", () => {
    expect(DEFAULT_MODEL_PORTFOLIOS).toHaveLength(4);
  });

  it("each model portfolio weights sum to 1", () => {
    for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
      const sum = mp.allocations.reduce((s, a) => s + a.weight, 0);
      expect(sum).toBeCloseTo(1.0, 4);
    }
  });

  it("portfolio allocations reference valid asset class names", () => {
    const validNames = new Set(DEFAULT_ASSET_CLASSES.map((ac) => ac.name));
    for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
      for (const alloc of mp.allocations) {
        expect(validNames.has(alloc.assetClassName)).toBe(true);
      }
    }
  });
});
