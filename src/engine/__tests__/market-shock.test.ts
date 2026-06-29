import { describe, it, expect } from "vitest";
import { applyMarketShock, MARKET_EXPOSED_CATEGORIES } from "../market-shock";
import { sampleAccounts } from "./fixtures";
import type { AccountLedger } from "../types";

function emptyLedgers(ids: string[]): Record<string, AccountLedger> {
  const out: Record<string, AccountLedger> = {};
  for (const id of ids) {
    out[id] = {
      beginningValue: 0, growth: 0, contributions: 0, distributions: 0,
      internalContributions: 0, internalDistributions: 0, rmdAmount: 0,
      fees: 0, endingValue: 0, entries: [], basisBoY: 0,
    };
  }
  return out;
}

describe("MARKET_EXPOSED_CATEGORIES", () => {
  it("includes investment categories and excludes safe ones", () => {
    expect(MARKET_EXPOSED_CATEGORIES.has("taxable")).toBe(true);
    expect(MARKET_EXPOSED_CATEGORIES.has("retirement")).toBe(true);
    expect(MARKET_EXPOSED_CATEGORIES.has("cash")).toBe(false);
    expect(MARKET_EXPOSED_CATEGORIES.has("real_estate")).toBe(false);
  });
});

describe("applyMarketShock", () => {
  it("haircuts only market-exposed balances in the shock year", () => {
    const balances: Record<string, number> = {
      "acct-401k": 500_000,   // retirement → hit
      "acct-roth": 200_000,   // retirement → hit
      "acct-brokerage": 300_000, // taxable → hit
      "acct-savings": 50_000, // cash → untouched
      "acct-home": 750_000,   // real_estate → untouched
    };
    const ledgers = emptyLedgers(Object.keys(balances));
    applyMarketShock(balances, sampleAccounts, 2030, { year: 2030, drawdownPct: 0.3 }, ledgers);
    expect(balances["acct-401k"]).toBeCloseTo(350_000, 2);
    expect(balances["acct-roth"]).toBeCloseTo(140_000, 2);
    expect(balances["acct-brokerage"]).toBeCloseTo(210_000, 2);
    expect(balances["acct-savings"]).toBe(50_000);
    expect(balances["acct-home"]).toBe(750_000);
    expect(ledgers["acct-401k"].entries).toHaveLength(1);
    expect(ledgers["acct-401k"].entries[0].amount).toBeCloseTo(-150_000, 2);
    expect(ledgers["acct-401k"].endingValue).toBeCloseTo(-150_000, 2);
  });

  it("is a no-op outside the shock year", () => {
    const balances: Record<string, number> = { "acct-401k": 500_000 };
    const ledgers = emptyLedgers(["acct-401k"]);
    applyMarketShock(balances, sampleAccounts, 2029, { year: 2030, drawdownPct: 0.3 }, ledgers);
    expect(balances["acct-401k"]).toBe(500_000);
    expect(ledgers["acct-401k"].entries).toHaveLength(0);
  });

  it("is a no-op when shock is undefined", () => {
    const balances: Record<string, number> = { "acct-401k": 500_000 };
    const ledgers = emptyLedgers(["acct-401k"]);
    applyMarketShock(balances, sampleAccounts, 2030, undefined, ledgers);
    expect(balances["acct-401k"]).toBe(500_000);
  });
});
