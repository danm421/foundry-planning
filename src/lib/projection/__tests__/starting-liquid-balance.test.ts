import { describe, it, expect } from "vitest";
import {
  computeStartingLiquidBalance,
  type LiquidAccountInput,
} from "../starting-liquid-balance";

const acct = (over: Partial<LiquidAccountInput>): LiquidAccountInput => ({
  id: "a",
  category: "taxable",
  value: 100,
  entityId: null,
  ...over,
});

describe("computeStartingLiquidBalance", () => {
  it("sums only taxable/cash/retirement household accounts", () => {
    const accounts = [
      acct({ id: "1", category: "taxable", value: 250_000 }),
      acct({ id: "2", category: "cash", value: 30_000 }),
      acct({ id: "3", category: "retirement", value: 100_000 }),
      acct({ id: "4", category: "real_estate", value: 900_000 }),
      acct({ id: "5", category: "business", value: 500_000 }),
    ];
    expect(
      computeStartingLiquidBalance(accounts, new Map(), new Map()),
    ).toBe(380_000);
  });

  it("prefers a holdings-derived value over the account value when present", () => {
    const accounts = [acct({ id: "1", category: "taxable", value: 250_000 })];
    const holdings = new Map([["1", 275_000]]);
    expect(
      computeStartingLiquidBalance(accounts, new Map(), holdings),
    ).toBe(275_000);
  });

  it("keeps a holdings value of 0 (0 is not treated as missing)", () => {
    const accounts = [acct({ id: "1", category: "cash", value: 30_000 })];
    const holdings = new Map([["1", 0]]);
    expect(
      computeStartingLiquidBalance(accounts, new Map(), holdings),
    ).toBe(0);
  });

  it("excludes accounts owned by an out-of-portfolio entity, includes in-portfolio ones", () => {
    const accounts = [
      acct({ id: "1", category: "taxable", value: 100_000, entityId: "trust-out" }),
      acct({ id: "2", category: "taxable", value: 50_000, entityId: "trust-in" }),
      acct({ id: "3", category: "taxable", value: 25_000, entityId: null }),
    ];
    const entityInPortfolio = new Map([
      ["trust-out", false],
      ["trust-in", true],
    ]);
    expect(
      computeStartingLiquidBalance(accounts, entityInPortfolio, new Map()),
    ).toBe(75_000); // trust-in (50k) + household (25k); trust-out excluded
  });
});
