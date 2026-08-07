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
    applyMarketShock(balances, sampleAccounts, 2030, { year: 2030, drawdownPct: 0.3 }, ledgers, {});
    expect(balances["acct-401k"]).toBeCloseTo(350_000, 2);
    expect(balances["acct-roth"]).toBeCloseTo(140_000, 2);
    expect(balances["acct-brokerage"]).toBeCloseTo(210_000, 2);
    expect(balances["acct-savings"]).toBe(50_000);
    expect(balances["acct-home"]).toBe(750_000);
    expect(ledgers["acct-401k"].entries).toHaveLength(1);
    expect(ledgers["acct-401k"].entries[0].amount).toBeCloseTo(-150_000, 2);
    expect(ledgers["acct-401k"].endingValue).toBeCloseTo(-150_000, 2);
  });

  it("records the drawdown in ledger.growth, not just in the entry list", () => {
    // The entry is pushed with category "growth", and every "Portfolio Growth"
    // surface (cashflow report, presentation drill, asset-ledger summary) reads
    // the `growth` scalar rather than summing entries. Leaving the scalar alone
    // makes the crash year report a normal positive growth number while the
    // itemized rows underneath it show the crash.
    const balances: Record<string, number> = { "acct-401k": 500_000 };
    const ledgers = emptyLedgers(["acct-401k"]);
    ledgers["acct-401k"].growth = 35_000; // this year's growth pass, pre-shock
    applyMarketShock(balances, sampleAccounts, 2030, { year: 2030, drawdownPct: 0.3 }, ledgers, {});
    expect(ledgers["acct-401k"].growth).toBeCloseTo(35_000 - 150_000, 2);
    // The scalar must equal the sum of its own growth-category entries.
    const entryGrowth = ledgers["acct-401k"].entries
      .filter((e) => e.category === "growth")
      .reduce((s, e) => s + e.amount, 0);
    expect(ledgers["acct-401k"].growth).toBeCloseTo(35_000 + entryGrowth, 2);
  });

  it("writes down the Roth-designated slice by the same proportion", () => {
    // rothValue tracks the balance so the Roth fraction stays constant absent
    // contributions or withdrawals. Left ungrown-down, a shocked 401(k) ends
    // with a Roth slice larger than the whole account — which zeroes the
    // pre-tax RMD basis (projection.ts `Math.max(0, balance - rothValue)`).
    const balances: Record<string, number> = { "acct-401k": 500_000 };
    const rothValueMap: Record<string, number> = { "acct-401k": 250_000 };
    const ledgers = emptyLedgers(["acct-401k"]);
    applyMarketShock(balances, sampleAccounts, 2030, { year: 2030, drawdownPct: 0.3 }, ledgers, rothValueMap);
    expect(balances["acct-401k"]).toBeCloseTo(350_000, 2);
    expect(rothValueMap["acct-401k"]).toBeCloseTo(175_000, 2);
    expect(rothValueMap["acct-401k"] / balances["acct-401k"]).toBeCloseTo(0.5, 6);
  });

  it("leaves the Roth slice of an untouched category alone", () => {
    const balances: Record<string, number> = { "acct-savings": 50_000 };
    const rothValueMap: Record<string, number> = { "acct-savings": 10_000 };
    const ledgers = emptyLedgers(["acct-savings"]);
    applyMarketShock(balances, sampleAccounts, 2030, { year: 2030, drawdownPct: 0.3 }, ledgers, rothValueMap);
    expect(rothValueMap["acct-savings"]).toBe(10_000);
  });

  it("is a no-op outside the shock year", () => {
    const balances: Record<string, number> = { "acct-401k": 500_000 };
    const ledgers = emptyLedgers(["acct-401k"]);
    applyMarketShock(balances, sampleAccounts, 2029, { year: 2030, drawdownPct: 0.3 }, ledgers, {});
    expect(balances["acct-401k"]).toBe(500_000);
    expect(ledgers["acct-401k"].entries).toHaveLength(0);
  });

  it("is a no-op when shock is undefined", () => {
    const balances: Record<string, number> = { "acct-401k": 500_000 };
    const ledgers = emptyLedgers(["acct-401k"]);
    applyMarketShock(balances, sampleAccounts, 2030, undefined, ledgers, {});
    expect(balances["acct-401k"]).toBe(500_000);
  });
});
