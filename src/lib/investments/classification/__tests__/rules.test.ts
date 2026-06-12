import { describe, it, expect } from "vitest";
import { classifyBondBenchmark, classifyCommodityLike, isCashFund } from "../rules";

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
