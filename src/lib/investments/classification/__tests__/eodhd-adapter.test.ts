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

// ── Mutual-fund payload shape ────────────────────────────────────────────────
// EODHD returns a COMPLETELY different shape for `MutualFund_Data` than for
// `ETF_Data`: every field we read is renamed or re-nested. Verbatim excerpt of
// the live SWPPX.US response (2026-09-10), trimmed to the fields we map.
const MF_FIXTURE = {
  General: {
    Name: "Schwab S&P 500 Index Fund", Type: "FUND", Code: "SWPPX",
    Category: null,                 // ← the ETF field is ALWAYS null on a fund
    Fund_Category: "Large Blend",   // ← the category actually lives here
  },
  MutualFund_Data: {
    Fund_Category: "Large Blend",
    // Index-keyed array, `Type` names the bucket, `Net_%` not `Net_Assets_%`.
    Asset_Allocation: {
      "0": { Type: "Cash",           "Net_%": "0.34719" },
      "1": { Type: "Not Classified", "Net_%": "0.0" },
      "2": { Type: "Non US Stock",   "Net_%": "0.49740" },
      "3": { Type: "Other",          "Net_%": "0.00000" },
      "4": { Type: "US Stock",       "Net_%": "99.15541" },
      "5": { Type: "Bond",           "Net_%": "0.00000" },
    },
    // American spelling, index-keyed, `Size` names the tier, and the tiers
    // differ: Giant/Large where the ETF shape says Mega/Big. Row 0 is an
    // absolute dollar average, NOT a percentage — it must not be read as one.
    Market_Capitalization: {
      "0": { Size: "AverageMarketCap", "Portfolio_%": 496152.8348 },
      "1": { Size: "Giant",  "Portfolio_%": 44.94899 },
      "2": { Size: "Large",  "Portfolio_%": 34.88219 },
      "3": { Size: "Medium", "Portfolio_%": 18.73538 },
      "4": { Size: "Small",  "Portfolio_%": 1.08626 },
      "5": { Size: "Micro",  "Portfolio_%": 0 },
    },
    // Grouped by continent, then index-keyed; `Stocks_%` not `Equity_%`.
    World_Regions: {
      Americas: {
        "0": { Name: "North America", "Stocks_%": 99.501 },
        "1": { Name: "Latin America", "Stocks_%": 0.065 },
      },
      "Greater Asia": {
        "0": { Name: "Japan", "Stocks_%": 0 },
        "3": { Name: "Asia Emerging", "Stocks_%": 0.093 },
      },
      "Greater Europe": {
        "0": { Name: "United Kingdom", "Stocks_%": 0.03222 },
        "2": { Name: "Europe Emerging", "Stocks_%": 0 },
      },
    },
    // Grouped by super-sector, then index-keyed; `Amount_%` not `Equity_%`.
    Sector_Weights: {
      Cyclical: {
        "0": { Name: "Basic Materials", "Amount_%": 1.61913 },
        "3": { Name: "Real Estate", "Amount_%": 1.88518 },
      },
      Defensive: { "1": { Name: "Healthcare", "Amount_%": 9.09901 } },
    },
  },
};

describe("mapEodhdToInput — mutual fund payload shape", () => {
  it("reads the category from General.Fund_Category when General.Category is null", () => {
    // Regression: reading only General.Category made EVERY fund uncategorised.
    const input = mapEodhdToInput("SWPPX", MF_FIXTURE);
    expect(input.securityType).toBe("mutual_fund");
    // "Large Blend" is a Tier-3 category → falls through to the allocation.
    expect(input.definitiveSlug).toBeUndefined();
  });

  it("maps the index-keyed Asset_Allocation via its Type field", () => {
    const input = mapEodhdToInput("SWPPX", MF_FIXTURE);
    expect(input.assetAllocation).toEqual({
      stockUS: 99.15541, stockNonUS: 0.4974, bond: 0, cash: 0.34719, other: 0,
    });
  });

  it("maps Market_Capitalization tiers, ignoring the AverageMarketCap dollar row", () => {
    const input = mapEodhdToInput("SWPPX", MF_FIXTURE);
    expect(input.marketCapTiers).toEqual({
      mega: 44.94899, big: 34.88219, medium: 18.73538, small: 1.08626, micro: 0,
    });
  });

  it("flattens the grouped World_Regions and Sector_Weights", () => {
    const input = mapEodhdToInput("SWPPX", MF_FIXTURE);
    expect(input.realEstatePctOfEquity).toBeCloseTo(1.88518, 4);
    // Non-US equity = 0.065 + 0.093 + 0.03222 + 0 ≈ 0.19; emerging = 0.065 + 0.093.
    expect(input.emergingPctOfNonUS).toBeGreaterThan(70);
    expect(input.emergingPctOfNonUS).toBeLessThanOrEqual(100);
  });

  it("derives a real US-equity blend, NOT 100% inflation", () => {
    // The bug this guards: an unreadable payload mapped to all-zeros and
    // derived as a confident `inflation 100%` row, persisted as
    // classifier_source='eodhd' and served forever as a cache hit.
    const blend = deriveAssetClassBlend(mapEodhdToInput("SWPPX", MF_FIXTURE));
    const bySlug = Object.fromEntries(blend.map((w) => [w.slug, w.weight]));
    expect(bySlug.inflation ?? 0).toBeLessThan(0.05);
    expect((bySlug.us_large_cap ?? 0) + (bySlug.us_mid_cap ?? 0) + (bySlug.us_small_cap ?? 0)).toBeGreaterThan(0.9);
  });

  it("still reads a definitive fund category from MutualFund_Data.Fund_Category", () => {
    // VFIDX is one of the 22 prod rows this bug recorded as `inflation 100%`.
    // Generic bond families intentionally proxy to the intermediate-bond slug
    // (rules.ts:82) — the point here is that the category is READ at all.
    const input = mapEodhdToInput("VFIDX", {
      General: { Name: "Vanguard Intermediate-Term Investment Grade", Type: "FUND", Category: null },
      MutualFund_Data: { Fund_Category: "Corporate Bond" },
    });
    expect(input.definitiveSlug).toBe("ten_year_treasury");
  });
});
