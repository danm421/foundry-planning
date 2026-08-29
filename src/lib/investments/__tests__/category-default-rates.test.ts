import { describe, it, expect } from "vitest";
import { categoryDefaultRates } from "../category-default-rates";

const settings = {
  growthSourceTaxable: "model_portfolio",
  modelPortfolioIdTaxable: "mp-1",
  defaultGrowthTaxable: "0.05",
  growthSourceCash: "inflation",
  modelPortfolioIdCash: null,
  defaultGrowthCash: "0.01",
  growthSourceRetirement: "custom",
  modelPortfolioIdRetirement: null,
  defaultGrowthRetirement: "0.07",
  growthSourceRealEstate: "custom",
  defaultGrowthRealEstate: "0.03",
  growthSourceBusiness: "custom",
  defaultGrowthBusiness: "0.04",
  growthSourceStockOptions: "custom",
  defaultGrowthStockOptions: "0.08",
  growthSourceLifeInsurance: "custom",
  defaultGrowthLifeInsurance: "0.02",
};
const portfolios = [{ id: "mp-1", blendedReturn: 0.062 }];

describe("categoryDefaultRates", () => {
  it("resolves a model-portfolio-backed category to the blended return", () => {
    expect(categoryDefaultRates(settings, portfolios, 0.025).taxable).toBe("0.062");
  });

  it("resolves an inflation-backed category to the resolved inflation rate", () => {
    expect(categoryDefaultRates(settings, portfolios, 0.025).cash).toBe("0.025");
  });

  it("falls back to the custom rate", () => {
    expect(categoryDefaultRates(settings, portfolios, 0.025).retirement).toBe("0.07");
  });

  it("aliases education_savings to the retirement defaults", () => {
    const rates = categoryDefaultRates(settings, portfolios, 0.025);
    expect(rates.education_savings).toBe(rates.retirement);
  });

  it("aliases annuity to the retirement defaults", () => {
    const rates = categoryDefaultRates(settings, portfolios, 0.025);
    expect(rates.annuity).toBe(rates.retirement);
  });

  it("covers all ten categories", () => {
    expect(Object.keys(categoryDefaultRates(settings, portfolios, 0.025))).toHaveLength(10);
  });

  it("returns the hardcoded fallback map when the plan has no settings row", () => {
    // annuity was "0.04" (the real-estate rate) until 2026-08-28, when
    // annuities gained a real growth dropdown and were aliased to the
    // retirement defaults everywhere. Every other figure is still verbatim
    // from the pre-extraction ternary's settings-falsy branch
    // (net-worth-content.tsx at base dd88d58bf) — checked against that
    // source, not against category-default-rates.ts's own constant, so a
    // transcription error in the constant can't confirm itself here.
    expect(categoryDefaultRates(undefined, portfolios, 0.025)).toEqual({
      taxable: "0.07",
      cash: "0.02",
      retirement: "0.07",
      education_savings: "0.07",
      annuity: "0.07",
      real_estate: "0.04",
      business: "0.05",
      stock_options: "0.07",
      life_insurance: "0.03",
      notes_receivable: "0",
    });
  });
});
