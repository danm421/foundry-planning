import { describe, it, expect } from "vitest";
import { buildPlanGrowthDefaults } from "../investments-bundle";

// Minimal structural stand-in for the Drizzle planSettings row. Decimal columns
// come back from Drizzle as strings; the builder must coerce them.
const ROW = {
  growthSourceTaxable: "model_portfolio",
  growthSourceCash: "inflation",
  growthSourceRetirement: "model_portfolio",
  growthSourceRealEstate: "custom",
  growthSourceBusiness: "inflation",
  growthSourceLifeInsurance: "custom",
  modelPortfolioIdTaxable: "mp-1",
  modelPortfolioIdCash: null,
  modelPortfolioIdRetirement: "mp-2",
  defaultGrowthTaxable: "0.0600",
  defaultGrowthCash: "0.0200",
  defaultGrowthRetirement: "0.0700",
  defaultGrowthRealEstate: "0.0300",
  defaultGrowthBusiness: "0.0400",
  defaultGrowthLifeInsurance: "0.0500",
};

describe("buildPlanGrowthDefaults", () => {
  it("maps sources, portfolio ids, and coerces decimal custom rates", () => {
    const d = buildPlanGrowthDefaults(ROW);
    expect(d.taxable).toEqual({ source: "model_portfolio", modelPortfolioId: "mp-1", customRate: 0.06 });
    expect(d.cash).toEqual({ source: "inflation", modelPortfolioId: null, customRate: 0.02 });
    expect(d.realEstate).toEqual({ source: "custom", modelPortfolioId: null, customRate: 0.03 });
    expect(d.lifeInsurance.source).toBe("custom");
    expect(d.lifeInsurance.customRate).toBe(0.05);
  });

  it("falls back to 'default' source and 0 rate on unknown/null input", () => {
    const d = buildPlanGrowthDefaults({} as never);
    expect(d.taxable.source).toBe("default");
    expect(d.taxable.customRate).toBe(0);
    expect(d.taxable.modelPortfolioId).toBe(null);
  });
});
