import { describe, it, expect } from "vitest";
import {
  growthEditModeFor,
  growthOptionsFor,
  growthSelectValue,
  formatGrowthPct,
} from "../growth-options";

const ctx = {
  modelPortfolios: [
    { id: "mp-1", name: "Balanced", blendedReturn: 0.062 },
    { id: "mp-2", name: "Growth", blendedReturn: 0.0724 },
  ],
  fundPortfolios: [{ id: "tp-1", name: "Core Four", blendedReturnPct: 5.9 }],
  resolvedInflationRate: 0.025,
  defaultPctForCategory: 5.4,
  assetMixBlendedPct: 6.8,
  hideAssetMix: false,
};

describe("growthEditModeFor", () => {
  it("gives the full dropdown to the four dropdown categories", () => {
    for (const c of ["taxable", "cash", "retirement", "education_savings"]) {
      expect(growthEditModeFor(c)).toBe("full");
    }
  });

  it("gives real_estate the two-option select", () => {
    expect(growthEditModeFor("real_estate")).toBe("inflation_custom");
  });

  it("gives annuity, business and notes_receivable custom only", () => {
    for (const c of ["annuity", "business", "notes_receivable"]) {
      expect(growthEditModeFor(c)).toBe("custom_only");
    }
  });

  it("gives stock_options no editor", () => {
    expect(growthEditModeFor("stock_options")).toBe("none");
  });

  it("gives life_insurance no editor — it is out of scope", () => {
    expect(growthEditModeFor("life_insurance")).toBe("none");
  });
});

describe("growthOptionsFor", () => {
  it("offers asset mix and inflation for taxable", () => {
    const values = growthOptionsFor({ category: "taxable", ...ctx }).map((o) => o.value);
    expect(values).toEqual(["default", "mp:mp-1", "mp:mp-2", "tp:tp-1", "asset_mix", "inflation", "custom"]);
  });

  it("omits asset mix for cash but keeps inflation", () => {
    const values = growthOptionsFor({ category: "cash", ...ctx }).map((o) => o.value);
    expect(values).not.toContain("asset_mix");
    expect(values).toContain("inflation");
  });

  it("omits both asset mix and inflation for education_savings", () => {
    const values = growthOptionsFor({ category: "education_savings", ...ctx }).map((o) => o.value);
    expect(values).toEqual(["default", "mp:mp-1", "mp:mp-2", "tp:tp-1", "custom"]);
  });

  it("offers only inflation and custom for real_estate", () => {
    const values = growthOptionsFor({ category: "real_estate", ...ctx }).map((o) => o.value);
    expect(values).toEqual(["inflation", "custom"]);
  });

  it("offers only custom for business", () => {
    const values = growthOptionsFor({ category: "business", ...ctx }).map((o) => o.value);
    expect(values).toEqual(["custom"]);
  });

  it("returns nothing for stock_options", () => {
    expect(growthOptionsFor({ category: "stock_options", ...ctx })).toEqual([]);
  });

  it("hides asset mix when the account has no holdings to back it", () => {
    const values = growthOptionsFor({ category: "taxable", ...ctx, hideAssetMix: true }).map((o) => o.value);
    expect(values).not.toContain("asset_mix");
  });

  it("labels model portfolios with a two-decimal blended return", () => {
    const opts = growthOptionsFor({ category: "taxable", ...ctx });
    expect(opts.find((o) => o.value === "mp:mp-2")?.label).toBe("7.24% - Growth");
  });
});

describe("growthSelectValue", () => {
  it("round-trips a model portfolio selection", () => {
    expect(growthSelectValue({ growthSource: "model_portfolio", modelPortfolioId: "mp-1" })).toBe("mp:mp-1");
  });

  it("round-trips a ticker portfolio selection", () => {
    expect(growthSelectValue({ growthSource: "ticker_portfolio", tickerPortfolioId: "tp-1" })).toBe("tp:tp-1");
  });

  it("passes simple sources through unchanged", () => {
    expect(growthSelectValue({ growthSource: "inflation" })).toBe("inflation");
    expect(growthSelectValue({ growthSource: "custom" })).toBe("custom");
  });

  it("falls back to default when growthSource is absent", () => {
    expect(growthSelectValue({})).toBe("default");
  });
});

describe("formatGrowthPct", () => {
  it("renders two decimals so near-identical portfolios stay distinguishable", () => {
    expect(formatGrowthPct(0.0624)).toBe("6.24%");
    expect(formatGrowthPct(0.0621)).toBe("6.21%");
  });

  it("accepts the stringified rate AccountRow carries", () => {
    expect(formatGrowthPct("0.062")).toBe("6.20%");
  });

  it("renders an em dash when the rate is unknown", () => {
    expect(formatGrowthPct(null)).toBe("—");
  });
});
