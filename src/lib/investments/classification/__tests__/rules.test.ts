import { describe, it, expect } from "vitest";
import { classifyBondBenchmark, classifyCommodityLike } from "../rules";

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
