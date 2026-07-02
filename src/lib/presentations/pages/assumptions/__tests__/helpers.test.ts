import { describe, it, expect } from "vitest";
import {
  formatPct,
  blendReturn,
  growthSourceLabel,
  accountCategoryLabel,
} from "../helpers";

describe("assumptions helpers", () => {
  it("formatPct renders one decimal and guards non-finite", () => {
    expect(formatPct(0.062)).toBe("6.2%");
    expect(formatPct(0.03)).toBe("3.0%");
    expect(formatPct(Number.NaN)).toBe("—");
  });

  it("blendReturn is the weighted sum of per-class geometric returns", () => {
    const geo = new Map([["a", 0.08], ["b", 0.03]]);
    const weights = [{ assetClassId: "a", weight: 0.6 }, { assetClassId: "b", weight: 0.4 }];
    expect(blendReturn(weights, geo)).toBeCloseTo(0.06, 10);
  });

  it("growthSourceLabel maps each source to a display string", () => {
    const names = new Map([["mp-1", "60/40 Growth"]]);
    expect(growthSourceLabel({ growthSource: "model_portfolio", modelPortfolioId: "mp-1" }, names)).toBe("Model: 60/40 Growth");
    expect(growthSourceLabel({ growthSource: "inflation", modelPortfolioId: null }, names)).toBe("Inflation");
    expect(growthSourceLabel({ growthSource: "custom", modelPortfolioId: null }, names)).toBe("Custom");
    expect(growthSourceLabel({ growthSource: "asset_mix", modelPortfolioId: null }, names)).toBe("Asset mix");
    expect(growthSourceLabel({ growthSource: "ticker_portfolio", modelPortfolioId: null }, names)).toBe("Fund portfolio");
    expect(growthSourceLabel({ growthSource: "default", modelPortfolioId: null }, names)).toBe("Plan default");
  });

  it("accountCategoryLabel maps engine categories to display labels", () => {
    expect(accountCategoryLabel("real_estate")).toBe("Real Estate");
    expect(accountCategoryLabel("life_insurance")).toBe("Life Insurance");
    expect(accountCategoryLabel("taxable")).toBe("Taxable");
  });
});
