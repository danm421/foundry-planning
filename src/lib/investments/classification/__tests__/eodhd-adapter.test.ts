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

  it("routes a money-market fund to 100% cash despite an empty allocation", () => {
    // EODHD types money-market funds as a fund but returns no Asset_Allocation,
    // so without the cash-fund guard they fall into the inflation residual.
    const input = mapEodhdToInput("SPAXX", {
      General: { Name: "Fidelity Government Money Market Fund", Type: "FUND", Code: "SPAXX" },
      MutualFund_Data: {},
    });
    expect(input.securityType).toBe("mutual_fund");
    expect(input.assetAllocation).toEqual({
      stockUS: 0, stockNonUS: 0, bond: 0, cash: 100, other: 0,
    });
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
