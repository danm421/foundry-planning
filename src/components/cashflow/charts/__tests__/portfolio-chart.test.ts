import { describe, it, expect } from "vitest";
import { buildPortfolioDatasets } from "../portfolio-chart";
import { makeYear } from "./fixtures";

describe("buildPortfolioDatasets", () => {
  it("returns one series per portfolio bucket", () => {
    const labels = buildPortfolioDatasets().map((s) => s.label);
    expect(labels).toEqual([
      "Cash",
      "Taxable",
      "Retirement",
      "Life Insurance",
      "Real Estate",
      "Business",
      "Trusts & Businesses",
      "Accessible Trust Assets",
    ]);
  });

  it("each series reads the matching *Total field", () => {
    const series = buildPortfolioDatasets();
    const y = makeYear({
      year: 2026,
      portfolioAssets: {
        taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {},
        taxableTotal: 200_000,
        cashTotal: 50_000,
        retirementTotal: 800_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 25_000,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 1_075_000,
      },
    });
    expect(series.find((s) => s.label === "Cash")!.valueFor(y)).toBe(50_000);
    expect(series.find((s) => s.label === "Taxable")!.valueFor(y)).toBe(200_000);
    expect(series.find((s) => s.label === "Retirement")!.valueFor(y)).toBe(800_000);
    expect(series.find((s) => s.label === "Life Insurance")!.valueFor(y)).toBe(25_000);
  });
});
