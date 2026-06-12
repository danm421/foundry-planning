// src/lib/investments/classification/__tests__/eodhd-adapter.test.ts
import { describe, it, expect } from "vitest";
import { mapEodhdToInput } from "../eodhd-adapter";
import { deriveAssetClassBlend } from "../derive";

const ETF_FIXTURE = {
  General: { Name: "Vanguard Total Stock Market ETF", Type: "ETF", Code: "VTI" },
  ETF_Data: {
    Asset_Allocation: {
      "Stock US":     { "Long_%": "99.0", "Net_Assets_%": "99.0" },
      "Stock non-US": { "Long_%": "1.0",  "Net_Assets_%": "1.0" },
      "Bond":         { "Long_%": "0",    "Net_Assets_%": "0" },
      "Cash":         { "Long_%": "0",    "Net_Assets_%": "0" },
      "Other":        { "Long_%": "0",    "Net_Assets_%": "0" },
    },
    Market_Capitalisation: { Mega: "45", Big: "30", Medium: "15", Small: "7", Micro: "3" },
    World_Regions: {
      "North America": { "Equity_%": "99" },
      "Latin America": { "Equity_%": "0.5" },
      "Asia emerging": { "Equity_%": "0.5" },
    },
    Sector_Weights: { "Real Estate": { "Equity_%": "3.2" } },
    MorningStar: { Category_Benchmark: "CRSP US Total Market" },
  },
};

describe("mapEodhdToInput", () => {
  it("maps an ETF fundamentals payload into ClassifierInput", () => {
    const input = mapEodhdToInput("VTI", ETF_FIXTURE);
    expect(input.securityType).toBe("etf");
    expect(input.ticker).toBe("VTI");
    expect(input.assetAllocation).toEqual({
      stockUS: 99, stockNonUS: 1, bond: 0, cash: 0, other: 0,
    });
    expect(input.marketCapTiers).toEqual({ mega: 45, big: 30, medium: 15, small: 7, micro: 3 });
    expect(input.realEstatePctOfEquity).toBeCloseTo(3.2, 1);
    expect(input.categoryBenchmark).toBe("CRSP US Total Market");
    // 1 of 1 non-US equity is emerging (0.5 + 0.5) → ~100%.
    expect(input.emergingPctOfNonUS).toBeGreaterThan(0);
  });

  it("routes a money-market fund to 100% cash via definitiveSlug", () => {
    const input = mapEodhdToInput("SPAXX", {
      General: { Name: "Fidelity Government Money Market Fund", Type: "FUND", Code: "SPAXX" },
      MutualFund_Data: {},
    });
    expect(input.securityType).toBe("mutual_fund");
    expect(input.definitiveSlug).toBe("cash");
    expect(deriveAssetClassBlend(input)).toEqual([{ slug: "cash", weight: 1 }]);
  });

  it("classifies a common-stock payload as a stock input", () => {
    const STOCK = {
      General: { Name: "Apple Inc", Type: "Common Stock", Code: "AAPL", CountryISO: "US" },
      Highlights: { MarketCapitalization: 3.2e12 },
    };
    const input = mapEodhdToInput("AAPL", STOCK);
    expect(input.securityType).toBe("stock");
    expect(input.stockMarketCapUsd).toBe(3.2e12);
    expect(input.stockCountry).toBe("US");
  });
});

describe("category-first + sentinel guard", () => {
  const sentinelAlloc = {
    "Stock US": { "Net_Assets_%": "0" }, "Stock non-US": { "Net_Assets_%": "0" },
    "Bond": { "Net_Assets_%": "0" }, "Cash": { "Net_Assets_%": "100" },
    "Other": { "Net_Assets_%": "0" },
  };

  it("a definitive category overrides a cash-100 sentinel allocation (COMB)", () => {
    const input = mapEodhdToInput("COMB", {
      General: { Name: "GraniteShares Bloomberg Commodity", Type: "ETF", Category: "Commodities Broad Basket" },
      ETF_Data: { Asset_Allocation: sentinelAlloc },
    });
    expect(input.definitiveSlug).toBe("commodities");
    expect(deriveAssetClassBlend(input)).toEqual([{ slug: "commodities", weight: 1 }]);
  });

  it("a crypto category → inflation, never cash (BSOL)", () => {
    const input = mapEodhdToInput("BSOL", {
      General: { Name: "...", Type: "ETF", Category: "Digital Assets" },
      ETF_Data: { Asset_Allocation: sentinelAlloc },
    });
    expect(input.definitiveSlug).toBe("inflation");
  });

  it("an inverse category → inflation despite an over-100 cash allocation (SQQQ)", () => {
    const input = mapEodhdToInput("SQQQ", {
      General: { Name: "ProShares UltraPro Short QQQ", Type: "ETF", Category: "Trading--Inverse Equity" },
      ETF_Data: { Asset_Allocation: {
        "Stock US": { "Net_Assets_%": "-292.7" }, "Bond": { "Net_Assets_%": "26" },
        "Cash": { "Net_Assets_%": "368.7" }, "Other": { "Net_Assets_%": "0" },
      } },
    });
    expect(input.definitiveSlug).toBe("inflation");
  });

  it("sentinel guard: a reliable-equity category with a broken cash-100 allocation → inflation (FIXT)", () => {
    const input = mapEodhdToInput("FIXT", {
      General: { Name: "...", Type: "ETF", Category: "Global Small/Mid Stock" }, // Tier-3 → allocation
      ETF_Data: { Asset_Allocation: sentinelAlloc },
    });
    expect(input.definitiveSlug).toBe("inflation");
  });

  it("sentinel guard: a no-category cash-100 fund → inflation, not cash", () => {
    const input = mapEodhdToInput("ZZZZ", {
      General: { Name: "Unknown Fund", Type: "ETF" },
      ETF_Data: { Asset_Allocation: sentinelAlloc },
    });
    expect(input.definitiveSlug).toBe("inflation");
  });

  it("Defined Outcome / Derivative Income → inflation", () => {
    expect(mapEodhdToInput("XYZ", { General: { Type: "ETF", Category: "Defined Outcome" }, ETF_Data: {} }).definitiveSlug).toBe("inflation");
    expect(mapEodhdToInput("JEPI", { General: { Type: "ETF", Category: "Derivative Income" }, ETF_Data: {} }).definitiveSlug).toBe("inflation");
  });

  it("a reliable diversified-equity allocation is preserved (VOO)", () => {
    const input = mapEodhdToInput("VOO", {
      General: { Name: "Vanguard S&P 500", Type: "ETF", Category: "Large Blend" }, // Tier-3 → allocation
      ETF_Data: { Asset_Allocation: {
        "Stock US": { "Net_Assets_%": "99.2" }, "Stock non-US": { "Net_Assets_%": "0.3" },
        "Bond": { "Net_Assets_%": "0" }, "Cash": { "Net_Assets_%": "0.2" }, "Other": { "Net_Assets_%": "0" },
      } },
    });
    expect(input.definitiveSlug).toBeUndefined();
    expect(input.assetAllocation).toEqual({ stockUS: 99.2, stockNonUS: 0.3, bond: 0, cash: 0.2, other: 0 });
  });

  it("an 'other'-typed fund with a definitive category is classified by category (PDBC)", () => {
    const input = mapEodhdToInput("PDBC", {
      General: { Name: "Invesco Optimum Yield Diversified Commodity", Type: "OTHER", Category: "Commodities Broad Basket" },
      ETF_Data: {},
    });
    expect(input.securityType).toBe("mutual_fund"); // "other" normalizes to mutual_fund for fund types
    expect(input.definitiveSlug).toBe("commodities");
    expect(deriveAssetClassBlend(input)).toEqual([{ slug: "commodities", weight: 1 }]);
  });
});
