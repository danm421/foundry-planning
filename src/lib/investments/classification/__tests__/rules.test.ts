import { describe, it, expect } from "vitest";
import { classifyBondBenchmark, classifyCommodityLike, isCashFund, classifyCategory } from "../rules";

describe("bond benchmark keyword rules", () => {
  it("matches TIPS / inflation-protected", () => {
    expect(classifyBondBenchmark("Bloomberg US Treasury Inflation-Protected")).toBe("tips");
  });
  it("matches high yield", () => {
    expect(classifyBondBenchmark("ICE BofA US High Yield")).toBe("high_yield_corporate");
  });
  it("matches municipal", () => {
    expect(classifyBondBenchmark("Bloomberg Municipal Bond Index")).toBe("tax_exempt_muni");
  });
  it("matches short-term", () => {
    expect(classifyBondBenchmark("Bloomberg US Treasury 1-3 Year")).toBe("short_term_treasury");
  });
  it("matches long-term", () => {
    expect(classifyBondBenchmark("Bloomberg US Long Treasury 20+ Year")).toBe("long_term_treasury");
  });
  it("falls back to 10-year treasury", () => {
    expect(classifyBondBenchmark("Bloomberg US Aggregate Bond")).toBe("ten_year_treasury");
    expect(classifyBondBenchmark(undefined)).toBe("ten_year_treasury");
  });
});

describe("commodity-like keyword rules", () => {
  it("detects gold", () => {
    expect(classifyCommodityLike("GLD", "SPDR Gold Shares")).toBe("gold");
  });
  it("detects broad commodities", () => {
    expect(classifyCommodityLike("DBC", "Invesco DB Commodity Index")).toBe("commodities");
  });
  it("returns null when neither", () => {
    expect(classifyCommodityLike("VTI", "Vanguard Total Stock Market")).toBeNull();
  });
});

describe("cash-fund detection", () => {
  it("detects money-market funds by name", () => {
    expect(isCashFund("SPAXX", "Fidelity Government Money Market Fund", "FUND")).toBe(true);
    expect(isCashFund("VMFXX", "Vanguard Federal Money Market Fund", "FUND")).toBe(true);
    expect(isCashFund("VMRXX", "Vanguard Cash Reserves Federal Money Market Fund", "FUND")).toBe(true);
  });
  it("detects money / cash funds that omit the word 'market'", () => {
    expect(isCashFund("SWVXX", "Schwab Value Advantage Money Fund", "FUND")).toBe(true);
    expect(isCashFund("FDRXX", "Fidelity Government Cash Reserves", "FUND")).toBe(true);
  });
  it("detects by EODHD type when the name is terse", () => {
    expect(isCashFund("XXXXX", "Acme Sweep", "Money Market Fund")).toBe(true);
  });
  it("detects known sweep tickers even with no helpful name", () => {
    expect(isCashFund("FZFXX", "", "FUND")).toBe(true);
  });
  it("does not flag ordinary funds", () => {
    expect(isCashFund("VTI", "Vanguard Total Stock Market ETF", "ETF")).toBe(false);
    expect(isCashFund("BND", "Vanguard Total Bond Market ETF", "ETF")).toBe(false);
    expect(isCashFund(undefined, undefined, undefined)).toBe(false);
  });
});

describe("classifyCategory — Morningstar category → definitive slug", () => {
  it("Tier 1: definitive single-class mappings", () => {
    expect(classifyCategory("Money Market-Taxable")).toBe("cash");
    expect(classifyCategory("Prime Money Market")).toBe("cash");
    expect(classifyCategory("Muni National Interm")).toBe("tax_exempt_muni");
    expect(classifyCategory("Muni California Intermediate")).toBe("tax_exempt_muni");
    expect(classifyCategory("High Yield Muni")).toBe("tax_exempt_muni");          // muni before high-yield
    expect(classifyCategory("Ultrashort Bond")).toBe("short_term_treasury");
    expect(classifyCategory("Short-Term Bond")).toBe("short_term_treasury");
    expect(classifyCategory("Short Government")).toBe("short_term_treasury");
    expect(classifyCategory("Inflation-Protected Bond")).toBe("tips");
    expect(classifyCategory("Short-Term Inflation-Protected Bond")).toBe("tips"); // tips before short
    expect(classifyCategory("Long Government")).toBe("long_term_treasury");
    expect(classifyCategory("Long-Term Bond")).toBe("long_term_treasury");
    expect(classifyCategory("High Yield Bond")).toBe("high_yield_corporate");
    expect(classifyCategory("Bank Loan")).toBe("high_yield_corporate");
    expect(classifyCategory("Emerging Markets Bond")).toBe("high_yield_corporate");
    expect(classifyCategory("Intermediate Core Bond")).toBe("ten_year_treasury");
    expect(classifyCategory("Intermediate Core-Plus Bond")).toBe("ten_year_treasury");
    expect(classifyCategory("Intermediate Government")).toBe("ten_year_treasury");
    expect(classifyCategory("Multisector Bond")).toBe("ten_year_treasury");
    expect(classifyCategory("Corporate Bond")).toBe("ten_year_treasury");
    expect(classifyCategory("Preferred Stock")).toBe("ten_year_treasury");
    expect(classifyCategory("Convertibles")).toBe("ten_year_treasury");
    expect(classifyCategory("Commodities Broad Basket")).toBe("commodities");
    expect(classifyCategory("Commodities Focused")).toBe("commodities");
    expect(classifyCategory("Commodities Precious Metals")).toBe("gold");
    expect(classifyCategory("Real Estate")).toBe("reit");
    expect(classifyCategory("Global Real Estate")).toBe("reit");
  });

  it("Tier 2: unmodelable → inflation (never cash)", () => {
    expect(classifyCategory("Digital Assets")).toBe("inflation");
    expect(classifyCategory("Single Currency")).toBe("inflation");
    expect(classifyCategory("Trading--Leveraged Equity")).toBe("inflation");
    expect(classifyCategory("Trading--Inverse Equity")).toBe("inflation");
    expect(classifyCategory("Trading--Leveraged Commodities")).toBe("inflation"); // trading before commodity
    expect(classifyCategory("Trading--Miscellaneous")).toBe("inflation");
    expect(classifyCategory("Defined Outcome")).toBe("inflation");
    expect(classifyCategory("Derivative Income")).toBe("inflation");
    expect(classifyCategory("Systematic Trend")).toBe("inflation");
    expect(classifyCategory("Equity Market Neutral")).toBe("inflation");
    expect(classifyCategory("Long-Short Equity")).toBe("inflation");
  });

  it("Tier 3: allocation-reliable / unknown → null", () => {
    expect(classifyCategory("Large Blend")).toBeNull();
    expect(classifyCategory("Foreign Large Blend")).toBeNull();
    expect(classifyCategory("Diversified Emerging Mkts")).toBeNull();
    expect(classifyCategory("Technology")).toBeNull();
    expect(classifyCategory("Moderate Allocation")).toBeNull();
    expect(classifyCategory("Tactical Allocation")).toBeNull();
    expect(classifyCategory("Equity Hedged")).toBeNull();
    expect(classifyCategory("Natural Resources")).toBeNull();
    expect(classifyCategory("Equity Precious Metals")).toBeNull();      // mining equity, not bullion
    expect(classifyCategory("Equity Digital Assets")).toBeNull();       // crypto equity, not spot
    expect(classifyCategory("Energy Limited Partnership")).toBeNull();
    expect(classifyCategory("")).toBeNull();
    expect(classifyCategory(undefined)).toBeNull();
  });
});
