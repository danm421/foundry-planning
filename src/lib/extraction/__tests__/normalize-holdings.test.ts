import { describe, expect, it } from "vitest";
import {
  normalizeExtractedHolding,
  holdingMarketValue,
  holdingsReconciliation,
} from "../normalize-holdings";

describe("normalizeExtractedHolding", () => {
  it("fills marketValue from shares * price", () => {
    const r = normalizeExtractedHolding({ ticker: "VTI", shares: 10, price: 200 });
    expect(r.marketValue).toBe(2000);
  });

  it("fills price from marketValue / shares", () => {
    const r = normalizeExtractedHolding({ name: "ABC Bond", shares: 5, marketValue: 5050 });
    expect(r.price).toBe(1010);
  });

  it("fills shares from marketValue / price", () => {
    const r = normalizeExtractedHolding({ ticker: "VTI", price: 200, marketValue: 2000 });
    expect(r.shares).toBe(10);
  });

  it("defaults cash to price 1", () => {
    const r = normalizeExtractedHolding({ name: "Cash", shares: 1234.56 });
    expect(r.price).toBe(1);
    expect(r.marketValue).toBe(1234.56);
  });

  it("does not divide by zero shares", () => {
    const r = normalizeExtractedHolding({ name: "X", shares: 0, marketValue: 100 });
    expect(r.price).toBeUndefined();
  });

  it("leaves a fully-specified holding unchanged", () => {
    const r = normalizeExtractedHolding({ ticker: "VTI", shares: 10, price: 200, marketValue: 2000, costBasis: 1500 });
    expect(r).toEqual({ ticker: "VTI", shares: 10, price: 200, marketValue: 2000, costBasis: 1500 });
  });
});

describe("holdingMarketValue", () => {
  it("prefers an explicit marketValue", () => {
    expect(holdingMarketValue({ ticker: "VTI", shares: 10, price: 200, marketValue: 1999 })).toBe(1999);
  });
  it("computes shares * price when marketValue absent", () => {
    expect(holdingMarketValue({ ticker: "VTI", shares: 10, price: 200 })).toBe(2000);
  });
  it("returns 0 when nothing is computable", () => {
    expect(holdingMarketValue({ ticker: "VTI" })).toBe(0);
  });
});

describe("holdingsReconciliation", () => {
  it("flags a material gap (both >1% and >$100)", () => {
    const r = holdingsReconciliation([{ shares: 1, price: 9000 }], 10000);
    expect(r.sum).toBe(9000);
    expect(r.gap).toBe(-1000);
    expect(r.flagged).toBe(true);
  });
  it("does not flag a tiny absolute gap on a large account", () => {
    const r = holdingsReconciliation([{ shares: 1, price: 4_999_950 }], 5_000_000);
    expect(r.flagged).toBe(false); // $50 gap, < $100
  });
  it("does not flag a small relative gap", () => {
    const r = holdingsReconciliation([{ shares: 1, price: 999_000 }], 1_000_000);
    expect(r.flagged).toBe(false); // 0.1% gap, < 1%
  });
  it("does not flag when total is 0", () => {
    expect(holdingsReconciliation([{ shares: 1, price: 100 }], 0).flagged).toBe(false);
  });
});
