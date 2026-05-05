import { describe, it, expect } from "vitest";
import { applyRothConversions } from "../roth-conversions";
import type { Account, AccountLedger, RothConversion } from "../types";
import type { BracketTier } from "@/lib/tax/types";

function makeLedger(value: number): AccountLedger {
  return {
    beginningValue: value, growth: 0, contributions: 0, distributions: 0,
    internalContributions: 0, internalDistributions: 0,
    rmdAmount: 0, fees: 0, endingValue: value, entries: [],
  };
}

const iraA: Account = {
  id: "ira-a", name: "IRA A", category: "retirement", subType: "traditional_ira",
  value: 400000, basis: 0, growthRate: 0.07, rmdEnabled: false, owners: [],
};
const iraB: Account = {
  id: "ira-b", name: "IRA B", category: "retirement", subType: "traditional_ira",
  value: 200000, basis: 0, growthRate: 0.07, rmdEnabled: false, owners: [],
};
const rothDest: Account = {
  id: "roth-1", name: "Roth IRA", category: "retirement", subType: "roth_ira",
  value: 0, basis: 0, growthRate: 0.07, rmdEnabled: false, owners: [],
};

function freshState() {
  return {
    accounts: [iraA, iraB, rothDest] as Account[],
    accountBalances: { "ira-a": 400000, "ira-b": 200000, "roth-1": 0 } as Record<string, number>,
    basisMap: { "ira-a": 0, "ira-b": 0, "roth-1": 0 } as Record<string, number>,
    accountLedgers: {
      "ira-a": makeLedger(400000),
      "ira-b": makeLedger(200000),
      "roth-1": makeLedger(0),
    } as Record<string, AccountLedger>,
  };
}

describe("applyRothConversions", () => {
  it("fixed_amount: converts a fixed dollar amount each year, indexed", () => {
    const conv: RothConversion = {
      id: "rc1", name: "Annual conversion", destinationAccountId: "roth-1",
      sourceAccountIds: ["ira-a"], conversionType: "fixed_amount",
      fixedAmount: 50000, startYear: 2026, endYear: 2030,
      indexingRate: 0.03, inflationStartYear: undefined,
    };
    const s = freshState();
    const r = applyRothConversions({
      conversions: [conv], ...s, year: 2028, ownerAges: { client: 60 },
    });
    // Year 2 of indexing → 50000 * 1.03^2
    const expected = 50000 * Math.pow(1.03, 2);
    expect(r.taxableOrdinaryIncome).toBeCloseTo(expected, 0);
    expect(s.accountBalances["ira-a"]).toBeCloseTo(400000 - expected, 0);
    expect(s.accountBalances["roth-1"]).toBeCloseTo(expected, 0);
  });

  it("full_account: drains the entire source pool in start year only", () => {
    const conv: RothConversion = {
      id: "rc2", name: "Full convert", destinationAccountId: "roth-1",
      sourceAccountIds: ["ira-a", "ira-b"], conversionType: "full_account",
      fixedAmount: 0, startYear: 2026, indexingRate: 0,
    };
    const s = freshState();
    const r = applyRothConversions({
      conversions: [conv], ...s, year: 2026, ownerAges: { client: 60 },
    });
    expect(r.taxableOrdinaryIncome).toBe(600000);
    expect(s.accountBalances["ira-a"]).toBe(0);
    expect(s.accountBalances["ira-b"]).toBe(0);
    expect(s.accountBalances["roth-1"]).toBe(600000);

    // In a later year, no further conversion happens.
    const s2 = freshState();
    s2.accountBalances["ira-a"] = 0; s2.accountBalances["ira-b"] = 0;
    const r2 = applyRothConversions({
      conversions: [conv], ...s2, year: 2027, ownerAges: { client: 61 },
    });
    expect(r2.taxableOrdinaryIncome).toBe(0);
  });

  it("deplete_over_period: spreads the pool evenly across the window", () => {
    const conv: RothConversion = {
      id: "rc3", name: "Deplete", destinationAccountId: "roth-1",
      sourceAccountIds: ["ira-a"], conversionType: "deplete_over_period",
      fixedAmount: 0, startYear: 2026, endYear: 2029, indexingRate: 0,
    };
    const s = freshState();
    // Year 1 of 4 → balance / 4 = 100000
    const r = applyRothConversions({
      conversions: [conv], ...s, year: 2026, ownerAges: { client: 60 },
    });
    expect(r.taxableOrdinaryIncome).toBe(100000);
    expect(s.accountBalances["ira-a"]).toBe(300000);
  });

  it("fill_up_bracket: tops out the chosen bracket", () => {
    const conv: RothConversion = {
      id: "rc4", name: "Fill 22%", destinationAccountId: "roth-1",
      sourceAccountIds: ["ira-a"], conversionType: "fill_up_bracket",
      fixedAmount: 0, fillUpBracket: 0.22, startYear: 2026, endYear: 2030,
      indexingRate: 0,
    };
    const s = freshState();
    // MFJ 2026-style brackets (illustrative).
    const ordinaryBrackets: BracketTier[] = [
      { from: 0,        to: 23200,   rate: 0.10 },
      { from: 23200,    to: 94300,   rate: 0.12 },
      { from: 94300,    to: 201050,  rate: 0.22 },
      { from: 201050,   to: 383900,  rate: 0.24 },
      { from: 383900,   to: null,    rate: 0.37 },
    ];
    const taxDeduction = 30000;
    const preConversionOrdinaryIncome = 80000; // taxable after dedn = 50000

    const r = applyRothConversions({
      conversions: [conv], ...s, year: 2026, ownerAges: { client: 60 },
      preConversionOrdinaryIncome,
      filingStatus: "married_joint",
      ordinaryBrackets,
      taxDeduction,
    });
    // Headroom = 201050 - (80000 - 30000) = 151050
    expect(r.taxableOrdinaryIncome).toBeCloseTo(151050, 0);
  });

  it("fill_up_bracket: 0 when the chosen bracket is already exceeded", () => {
    const conv: RothConversion = {
      id: "rc5", name: "Fill 12%", destinationAccountId: "roth-1",
      sourceAccountIds: ["ira-a"], conversionType: "fill_up_bracket",
      fixedAmount: 0, fillUpBracket: 0.12, startYear: 2026, endYear: 2030,
      indexingRate: 0,
    };
    const s = freshState();
    const ordinaryBrackets: BracketTier[] = [
      { from: 0,     to: 23200, rate: 0.10 },
      { from: 23200, to: 94300, rate: 0.12 },
      { from: 94300, to: null,  rate: 0.22 },
    ];
    const r = applyRothConversions({
      conversions: [conv], ...s, year: 2026, ownerAges: { client: 60 },
      preConversionOrdinaryIncome: 150000,
      filingStatus: "married_joint",
      ordinaryBrackets,
      taxDeduction: 30000,
    });
    expect(r.taxableOrdinaryIncome).toBe(0);
  });

  it("multi-source: drains in list order across two IRAs", () => {
    const conv: RothConversion = {
      id: "rc6", name: "Big convert", destinationAccountId: "roth-1",
      sourceAccountIds: ["ira-b", "ira-a"], conversionType: "fixed_amount",
      fixedAmount: 300000, startYear: 2026, indexingRate: 0,
    };
    const s = freshState();
    const r = applyRothConversions({
      conversions: [conv], ...s, year: 2026, ownerAges: { client: 60 },
    });
    expect(r.taxableOrdinaryIncome).toBe(300000);
    expect(s.accountBalances["ira-b"]).toBe(0);
    expect(s.accountBalances["ira-a"]).toBe(300000); // 400k - 100k
    expect(s.accountBalances["roth-1"]).toBe(300000);
  });

  it("skips when the conversion year is outside the window", () => {
    const conv: RothConversion = {
      id: "rc7", name: "Future", destinationAccountId: "roth-1",
      sourceAccountIds: ["ira-a"], conversionType: "fixed_amount",
      fixedAmount: 50000, startYear: 2030, indexingRate: 0,
    };
    const s = freshState();
    const r = applyRothConversions({
      conversions: [conv], ...s, year: 2026, ownerAges: { client: 60 },
    });
    expect(r.taxableOrdinaryIncome).toBe(0);
    expect(s.accountBalances["ira-a"]).toBe(400000);
  });

  it("byConversion: gross and taxable diverge when Trad-IRA pool has after-tax basis", () => {
    // Form 8606 pro-rata aggregates ALL Trad IRAs. Pool = 600k (ira-a + ira-b).
    // Set 150k of basis on ira-a → 25% basis fraction across the pool →
    // only 75% of any conversion is taxable.
    const conv: RothConversion = {
      id: "rc8", name: "Pro-rata convert", destinationAccountId: "roth-1",
      sourceAccountIds: ["ira-a"], conversionType: "fixed_amount",
      fixedAmount: 100000, startYear: 2026, indexingRate: 0,
    };
    const s = freshState();
    s.basisMap["ira-a"] = 150000; // 150k basis on 600k pool = 25%
    const r = applyRothConversions({
      conversions: [conv], ...s, year: 2026, ownerAges: { client: 60 },
    });
    const entry = r.byConversion["rc8"];
    expect(entry.gross).toBeCloseTo(100000, 0);
    expect(entry.taxable).toBeCloseTo(75000, 0);
    expect(entry.taxable).toBeLessThan(entry.gross);
    expect(r.taxableOrdinaryIncome).toBeCloseTo(75000, 0);
  });
});
