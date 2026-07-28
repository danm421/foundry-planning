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

  it("covers all ten categories", () => {
    expect(Object.keys(categoryDefaultRates(settings, portfolios, 0.025))).toHaveLength(10);
  });

  it("returns the hardcoded fallback map when the plan has no settings row", () => {
    const rates = categoryDefaultRates(undefined, portfolios, 0.025);
    expect(rates.taxable).toBe("0.07");
    expect(Object.keys(rates)).toHaveLength(10);
  });
});
