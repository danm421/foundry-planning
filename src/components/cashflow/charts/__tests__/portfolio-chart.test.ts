import { describe, it, expect } from "vitest";
import { buildPortfolioDatasets } from "../portfolio-chart";
import { makeYear } from "./fixtures";

describe("buildPortfolioDatasets", () => {
  it("returns one series per liquid portfolio bucket (H1)", () => {
    const labels = buildPortfolioDatasets().map((s) => s.label);
    expect(labels).toEqual([
      "Cash",
      "Taxable",
      "Retirement",
      "Life Insurance",
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
        accessibleTrustAssetsTotal: 10_000,
        total: 1_075_000,
        liquidTotal: 1_085_000,
      },
    });
    expect(series.find((s) => s.label === "Cash")!.valueFor(y)).toBe(50_000);
    expect(series.find((s) => s.label === "Taxable")!.valueFor(y)).toBe(200_000);
    expect(series.find((s) => s.label === "Retirement")!.valueFor(y)).toBe(800_000);
    expect(series.find((s) => s.label === "Life Insurance")!.valueFor(y)).toBe(25_000);
    expect(series.find((s) => s.label === "Accessible Trust Assets")!.valueFor(y)).toBe(10_000);
  });

  it("H1: portfolio chart segments sum to portfolioAssets.liquidTotal", () => {
    const y = {
      portfolioAssets: {
        cashTotal: 10, taxableTotal: 20, retirementTotal: 30, lifeInsuranceTotal: 5,
        accessibleTrustAssetsTotal: 7, realEstateTotal: 100, businessTotal: 50,
        trustsAndBusinessesTotal: 40, liquidTotal: 72, total: 215,
      },
    } as never;
    const segSum = buildPortfolioDatasets().reduce((s, d) => s + d.valueFor(y), 0);
    expect(segSum).toBe((y as { portfolioAssets: { liquidTotal: number } }).portfolioAssets.liquidTotal); // 72
  });
});
