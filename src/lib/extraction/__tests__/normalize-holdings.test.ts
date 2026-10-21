import { describe, expect, it } from "vitest";
import {
  normalizeExtractedHolding,
  sanitizeExtractedHolding,
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

  it("never lets cash carry a ticker — 'Cash' upper-cases to CASH, a real stock", () => {
    const r = normalizeExtractedHolding({ name: "Cash", ticker: "Cash", shares: 22598.53, price: 73.93 });
    expect(r.ticker).toBeUndefined();
    expect(r.price).toBe(1);
    expect(r.marketValue).toBe(22598.53);
  });

  it("keeps an advisor's quantity on a cash line — only a statement read takes it from the value", () => {
    const r = normalizeExtractedHolding({ name: "Cash", shares: 50000, price: 1, marketValue: 45534.59 });
    expect(r).toMatchObject({ shares: 50000, price: 1 });
  });

  it("leaves a real holding of the CASH stock (named for its issuer) a security", () => {
    const r = normalizeExtractedHolding({ name: "PATHWARD FINANCIAL INC", ticker: "CASH", shares: 10, price: 73.93 });
    expect(r).toMatchObject({ ticker: "CASH", price: 73.93 });
  });

  it("treats a sweep named for its line ('Bank Sweep') as cash, but not a money fund", () => {
    const sweep = normalizeExtractedHolding({ name: "Bank Sweep", ticker: "CHARLES SCHWAB BANK,X,Z", marketValue: 45534.59 });
    expect(sweep).toMatchObject({ shares: 45534.59, price: 1 });
    expect(sweep.ticker).toBeUndefined();
    const fund = normalizeExtractedHolding({ name: "Money Fund (Non-Sweep)", ticker: "SWVXX", shares: 100, price: 1 });
    expect(fund.ticker).toBe("SWVXX");
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

describe("sanitizeExtractedHolding (statement reads)", () => {
  it("keeps no zero or negative cost basis: a placeholder or a gain/(loss), never a basis", () => {
    expect(sanitizeExtractedHolding({ ticker: "QQQ", shares: 1, costBasis: 0 }).costBasis).toBeUndefined();
    expect(sanitizeExtractedHolding({ ticker: "T", shares: 1, costBasis: -865.09 }).costBasis).toBeUndefined();
    expect(sanitizeExtractedHolding({ ticker: "T", shares: 1, costBasis: 2014.81 }).costBasis).toBe(2014.81);
  });

  it("takes cash's quantity from its value, which is the period's ending balance", () => {
    const r = sanitizeExtractedHolding({ name: "Cash", shares: 41862.05, price: 1, marketValue: 45534.59 });
    expect(r).toMatchObject({ shares: 45534.59, price: 1, marketValue: 45534.59 });
  });

  it("drops a $1 money fund's basis that isn't its value (a balance column), keeps one that is", () => {
    expect(sanitizeExtractedHolding({ ticker: "SWVXX", price: 1, marketValue: 27314.62, costBasis: 27185.96 }).costBasis).toBeUndefined();
    expect(sanitizeExtractedHolding({ ticker: "SPAXX", price: 1, marketValue: 1000, costBasis: 1000 }).costBasis).toBe(1000);
  });

  it("keeps the basis of a floating-price fund that only sounds like cash", () => {
    const h = sanitizeExtractedHolding({ name: "ULTRA SHORT CASH MANAGEMENT FD", shares: 5000, price: 10.02, marketValue: 50100, costBasis: 49800 });
    expect(h.costBasis).toBe(49800);
  });

  it("keeps no basis on a cash line — its beginning balance or its own value, neither printed as one", () => {
    const h = sanitizeExtractedHolding({ name: "Bank Sweep", ticker: "CHARLES SCHWAB BANK,X,Z", marketValue: 45534.59, costBasis: 41862.05 });
    expect(h.costBasis).toBeUndefined();
    expect(h.ticker).toBeUndefined();
    expect(sanitizeExtractedHolding({ name: "Cash", marketValue: 45534.59, costBasis: 45534.59 }).costBasis).toBeUndefined();
  });

  it("leaves basis alone in the shared normalize, where an advisor's $0 is deliberate", () => {
    expect(normalizeExtractedHolding({ ticker: "AGG", shares: 1, costBasis: 0 }).costBasis).toBe(0);
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
