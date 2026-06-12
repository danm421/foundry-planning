import { describe, it, expect } from "vitest";
import { DEFAULT_ASSET_CLASSES, DEFAULT_MODEL_PORTFOLIOS } from "../cma-seed";

describe("CMA seed data", () => {
  it("provides 16 default asset classes", () => {
    expect(DEFAULT_ASSET_CLASSES).toHaveLength(16);
  });

  it("includes a fixed 0% Cash class", () => {
    const cash = DEFAULT_ASSET_CLASSES.find((a) => a.slug === "cash");
    expect(cash).toBeDefined();
    expect(cash!.name).toBe("Cash");
    expect(cash!.geometricReturn).toBe(0);
    expect(cash!.arithmeticMean).toBe(0);
    expect(cash!.volatility).toBe(0);
    expect(cash!.assetType).toBe("cash");
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
