import { describe, it, expect } from "vitest";
import { applyReinvestments } from "../reinvestments";
import type { Account, Reinvestment } from "../types";

function taxableAccount(id: string): Account {
  return {
    id,
    name: id,
    category: "taxable",
    subType: "brokerage",
    value: 100_000,
    basis: 60_000,
    rothValue: 0,
    growthRate: 0.05,
    rmdEnabled: false,
    isDefaultChecking: false,
    realization: {
      pctOrdinaryIncome: 0.2,
      pctLtCapitalGains: 0.8,
      pctQualifiedDividends: 0,
      pctTaxExempt: 0,
      turnoverPct: 0,
    },
    annualPropertyTax: 0,
    propertyTaxGrowthRate: 0,
    owners: [],
  };
}

function reinvestment(over: Partial<Reinvestment>): Reinvestment {
  return {
    id: "ri-1",
    name: "Shift to conservative",
    accountIds: ["a1"],
    year: 2030,
    newGrowthRate: 0.04,
    newRealization: {
      pctOrdinaryIncome: 0.5,
      pctLtCapitalGains: 0.5,
      pctQualifiedDividends: 0,
      pctTaxExempt: 0,
      turnoverPct: 0,
    },
    realizeTaxesOnSwitch: false,
    soldFractionByAccount: {},
    ...over,
  };
}

describe("applyReinvestments", () => {
  it("switches growthRate and realization in the reinvestment year", () => {
    const acct = taxableAccount("a1");
    applyReinvestments({
      reinvestments: [reinvestment({})],
      accounts: [acct],
      accountBalances: { a1: 100_000 },
      basisMap: { a1: 60_000 },
      accountLedgers: {},
      year: 2030,
    });
    expect(acct.growthRate).toBe(0.04);
    expect(acct.realization?.pctOrdinaryIncome).toBe(0.5);
  });

  it("does nothing in a non-reinvestment year", () => {
    const acct = taxableAccount("a1");
    applyReinvestments({
      reinvestments: [reinvestment({})],
      accounts: [acct],
      accountBalances: { a1: 100_000 },
      basisMap: { a1: 60_000 },
      accountLedgers: {},
      year: 2029,
    });
    expect(acct.growthRate).toBe(0.05);
  });

  it("a later reinvestment overrides an earlier one", () => {
    const acct = taxableAccount("a1");
    const first = reinvestment({ id: "ri-1", year: 2030, newGrowthRate: 0.04 });
    const second = reinvestment({ id: "ri-2", year: 2035, newGrowthRate: 0.03 });
    const ctx = {
      reinvestments: [first, second],
      accounts: [acct],
      accountBalances: { a1: 100_000 },
      basisMap: { a1: 60_000 },
      accountLedgers: {},
    };
    applyReinvestments({ ...ctx, year: 2030 });
    expect(acct.growthRate).toBe(0.04);
    applyReinvestments({ ...ctx, year: 2035 });
    expect(acct.growthRate).toBe(0.03);
  });

  it("leaves retirement realization undefined", () => {
    const acct = { ...taxableAccount("a1"), category: "retirement" as const, realization: undefined };
    applyReinvestments({
      reinvestments: [reinvestment({})],
      accounts: [acct],
      accountBalances: { a1: 100_000 },
      basisMap: { a1: 60_000 },
      accountLedgers: {},
      year: 2030,
    });
    expect(acct.growthRate).toBe(0.04);
    expect(acct.realization).toBeUndefined();
  });

  it("returns zero capital gains in Phase 1", () => {
    const result = applyReinvestments({
      reinvestments: [reinvestment({})],
      accounts: [taxableAccount("a1")],
      accountBalances: { a1: 100_000 },
      basisMap: { a1: 60_000 },
      accountLedgers: {},
      year: 2030,
    });
    expect(result.capitalGains).toBe(0);
  });
});
