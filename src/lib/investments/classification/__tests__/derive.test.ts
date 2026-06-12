import { describe, it, expect } from "vitest";
import { deriveAssetClassBlend } from "../derive";
import type { ClassifierInput, AssetClassWeightBySlug } from "../types";

function asMap(weights: AssetClassWeightBySlug[]): Record<string, number> {
  return Object.fromEntries(weights.map((w) => [w.slug, Number(w.weight.toFixed(4))]));
}
function sum(weights: AssetClassWeightBySlug[]): number {
  return Number(weights.reduce((a, w) => a + w.weight, 0).toFixed(4));
}

describe("deriveAssetClassBlend", () => {
  it("US large-cap individual stock", () => {
    const input: ClassifierInput = { securityType: "stock", stockMarketCapUsd: 2_000_000_000_000, stockCountry: "USA" };
    expect(asMap(deriveAssetClassBlend(input))).toEqual({ us_large_cap: 1 });
  });

  it("US small-cap individual stock", () => {
    const input: ClassifierInput = { securityType: "stock", stockMarketCapUsd: 800_000_000, stockCountry: "USA" };
    expect(asMap(deriveAssetClassBlend(input))).toEqual({ us_small_cap: 1 });
  });

  it("non-US developed stock", () => {
    const input: ClassifierInput = { securityType: "stock", stockMarketCapUsd: 5e10, stockCountry: "DE" };
    expect(asMap(deriveAssetClassBlend(input))).toEqual({ global_ex_us: 1 });
  });

  it("emerging-market stock", () => {
    const input: ClassifierInput = { securityType: "stock", stockMarketCapUsd: 5e10, stockCountry: "BR" };
    expect(asMap(deriveAssetClassBlend(input))).toEqual({ emerging_markets: 1 });
  });

  it("individual TIPS bond via name", () => {
    const input: ClassifierInput = { securityType: "bond", categoryBenchmark: "US Treasury Inflation-Protected Note" };
    expect(asMap(deriveAssetClassBlend(input))).toEqual({ tips: 1 });
  });

  it("pure US total-market ETF (100% US equity, all large)", () => {
    const input: ClassifierInput = {
      securityType: "etf",
      assetAllocation: { stockUS: 99, stockNonUS: 0, bond: 0, cash: 1, other: 0 },
      marketCapTiers: { mega: 50, big: 30, medium: 12, small: 6, micro: 2 },
      emergingPctOfNonUS: 0,
      realEstatePctOfEquity: 3,
    };
    const out = deriveAssetClassBlend(input);
    const m = asMap(out);
    expect(sum(out)).toBe(1);
    // 1% cash → cash class; 3% of equity → reit; rest split across caps.
    expect(m.reit).toBeGreaterThan(0);
    expect(m.us_large_cap).toBeGreaterThan(m.us_mid_cap);
    expect(m.cash).toBeCloseTo(0.01, 2);
  });

  it("60/40 balanced fund with intl + agg bonds", () => {
    const input: ClassifierInput = {
      securityType: "mutual_fund",
      assetAllocation: { stockUS: 40, stockNonUS: 20, bond: 39, cash: 1, other: 0 },
      marketCapTiers: { mega: 60, big: 25, medium: 10, small: 4, micro: 1 },
      emergingPctOfNonUS: 25,
      realEstatePctOfEquity: 0,
      categoryBenchmark: "Bloomberg US Aggregate Bond",
    };
    const out = deriveAssetClassBlend(input);
    const m = asMap(out);
    expect(sum(out)).toBe(1);
    expect(m.ten_year_treasury).toBeCloseTo(0.39, 2); // bond sleeve → agg → 10yr default
    expect(m.emerging_markets).toBeCloseTo(0.05, 2);   // 20% nonUS × 25%
    expect(m.global_ex_us).toBeCloseTo(0.15, 2);       // 20% nonUS × 75%
  });

  it("gold ETF via Other sleeve", () => {
    const input: ClassifierInput = {
      securityType: "etf",
      ticker: "GLD",
      assetAllocation: { stockUS: 0, stockNonUS: 0, bond: 0, cash: 0, other: 100 },
    };
    expect(asMap(deriveAssetClassBlend(input))).toEqual({ gold: 1 });
  });

  describe("cash routing", () => {
    it("routes a fund's cash sleeve to cash, leaving unmatched residual in inflation", () => {
      const out = deriveAssetClassBlend({
        securityType: "mutual_fund",
        ticker: "FOO",
        assetAllocation: { stockUS: 60, stockNonUS: 0, bond: 30, cash: 10, other: 0 },
      } as ClassifierInput);
      const m = asMap(out);
      expect(m.cash).toBeCloseTo(0.1, 4);
      expect(m.inflation ?? 0).toBe(0); // residual is fully accounted → no inflation
      expect(sum(out)).toBe(1);
    });

    it("classifies a ~100% cash money-market fund as cash", () => {
      const out = deriveAssetClassBlend({
        securityType: "mutual_fund",
        ticker: "SPAXX",
        assetAllocation: { stockUS: 0, stockNonUS: 0, bond: 0, cash: 100, other: 0 },
      } as ClassifierInput);
      expect(asMap(out)).toEqual({ cash: 1 });
    });

    it("classifies a cash-typed security as 100% cash", () => {
      const out = deriveAssetClassBlend({ securityType: "cash", ticker: "USD" } as ClassifierInput);
      expect(asMap(out)).toEqual({ cash: 1 });
    });

    it("still sinks genuinely-unclassifiable residual into inflation", () => {
      const out = deriveAssetClassBlend({ securityType: "other", ticker: "???" } as ClassifierInput);
      expect(asMap(out)).toEqual({ inflation: 1 });
    });
  });

  it("always sums to 1 and never emits negative weights", () => {
    const input: ClassifierInput = {
      securityType: "etf",
      assetAllocation: { stockUS: 30, stockNonUS: 10, bond: 50, cash: 5, other: 5 },
      marketCapTiers: { mega: 40, big: 30, medium: 20, small: 7, micro: 3 },
      emergingPctOfNonUS: 40,
      realEstatePctOfEquity: 10,
      categoryBenchmark: "High Yield",
    };
    const out = deriveAssetClassBlend(input);
    expect(sum(out)).toBe(1);
    for (const w of out) expect(w.weight).toBeGreaterThanOrEqual(0);
  });

  it("all-zero market-cap tiers fall back to us_large_cap (no silent loss to inflation)", () => {
    const input: ClassifierInput = {
      securityType: "etf",
      assetAllocation: { stockUS: 100, stockNonUS: 0, bond: 0, cash: 0, other: 0 },
      marketCapTiers: { mega: 0, big: 0, medium: 0, small: 0, micro: 0 },
      emergingPctOfNonUS: 0,
      realEstatePctOfEquity: 0,
    };
    const out = deriveAssetClassBlend(input);
    expect(asMap(out)).toEqual({ us_large_cap: 1 });
    expect(sum(out)).toBe(1);
  });
});
