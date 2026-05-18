import { describe, it, expect } from "vitest";
import { applyReinvestments } from "../reinvestments";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
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

  it("realizes LTCG on a partial switch and steps basis up", () => {
    const acct = taxableAccount("a1"); // value 100k, basis 60k
    const basisMap = { a1: 60_000 };
    const result = applyReinvestments({
      reinvestments: [
        reinvestment({ realizeTaxesOnSwitch: true, soldFractionByAccount: { a1: 0.25 } }),
      ],
      accounts: [acct],
      accountBalances: { a1: 100_000 },
      basisMap,
      accountLedgers: {},
      year: 2030,
    });
    // unrealized gain 40k * 0.25 = 10k
    expect(result.capitalGains).toBeCloseTo(10_000);
    expect(basisMap.a1).toBeCloseTo(70_000);
  });

  it("realizes the full gain when soldFraction is 1", () => {
    const basisMap = { a1: 60_000 };
    const result = applyReinvestments({
      reinvestments: [
        reinvestment({ realizeTaxesOnSwitch: true, soldFractionByAccount: { a1: 1 } }),
      ],
      accounts: [taxableAccount("a1")],
      accountBalances: { a1: 100_000 },
      basisMap,
      accountLedgers: {},
      year: 2030,
    });
    expect(result.capitalGains).toBeCloseTo(40_000);
    expect(basisMap.a1).toBeCloseTo(100_000);
  });

  it("realizes nothing when realizeTaxesOnSwitch is false", () => {
    const basisMap = { a1: 60_000 };
    const result = applyReinvestments({
      reinvestments: [
        reinvestment({ realizeTaxesOnSwitch: false, soldFractionByAccount: { a1: 1 } }),
      ],
      accounts: [taxableAccount("a1")],
      accountBalances: { a1: 100_000 },
      basisMap,
      accountLedgers: {},
      year: 2030,
    });
    expect(result.capitalGains).toBe(0);
    expect(basisMap.a1).toBe(60_000);
  });

  it("preserves the account's turnoverPct across a switch but replaces the mix", () => {
    // Account carries a non-zero turnover (an account-level property the
    // reinvestment resolver cannot know). The reinvestment's newRealization
    // carries turnoverPct: 0 (the resolver placeholder).
    const acct: Account = {
      ...taxableAccount("a1"),
      realization: {
        pctOrdinaryIncome: 0.2,
        pctLtCapitalGains: 0.8,
        pctQualifiedDividends: 0,
        pctTaxExempt: 0,
        turnoverPct: 0.3,
      },
    };
    applyReinvestments({
      reinvestments: [
        reinvestment({
          newRealization: {
            pctOrdinaryIncome: 0.5,
            pctLtCapitalGains: 0.5,
            pctQualifiedDividends: 0,
            pctTaxExempt: 0,
            turnoverPct: 0,
          },
        }),
      ],
      accounts: [acct],
      accountBalances: { a1: 100_000 },
      basisMap: { a1: 60_000 },
      accountLedgers: {},
      year: 2030,
    });
    // turnover is account-level — preserved, not zeroed by the switch.
    expect(acct.realization?.turnoverPct).toBe(0.3);
    // the OI/LTCG mix is replaced with the reinvestment's values.
    expect(acct.realization?.pctOrdinaryIncome).toBe(0.5);
    expect(acct.realization?.pctLtCapitalGains).toBe(0.5);
  });

  it("does not realize gains on a retirement account", () => {
    const acct = { ...taxableAccount("a1"), category: "retirement" as const };
    const basisMap = { a1: 60_000 };
    const result = applyReinvestments({
      reinvestments: [
        reinvestment({ realizeTaxesOnSwitch: true, soldFractionByAccount: { a1: 1 } }),
      ],
      accounts: [acct],
      accountBalances: { a1: 100_000 },
      basisMap,
      accountLedgers: {},
      year: 2030,
    });
    expect(result.capitalGains).toBe(0);
    expect(basisMap.a1).toBe(60_000);
  });
});

describe("reinvestment capital gains in a full projection", () => {
  it("surfaces LTCG in the reinvestment year and nowhere before it", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-brokerage",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 100_000,
          basis: 60_000,
          growthRate: 0.05,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
          // No turnover-driven realization: the only LTCG source is the
          // reinvestment switch itself.
          realization: {
            pctOrdinaryIncome: 0,
            pctLtCapitalGains: 0,
            pctQualifiedDividends: 0,
            pctTaxExempt: 0,
            turnoverPct: 0,
          },
        },
        {
          id: "acct-checking",
          name: "Checking",
          category: "cash",
          subType: "checking",
          value: 50_000,
          basis: 50_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
          isDefaultChecking: true,
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      reinvestments: [
        {
          id: "ri-1",
          name: "Shift to conservative",
          accountIds: ["acct-brokerage"],
          year: 2030,
          newGrowthRate: 0.04,
          newRealization: {
            pctOrdinaryIncome: 0,
            pctLtCapitalGains: 0,
            pctQualifiedDividends: 0,
            pctTaxExempt: 0,
            turnoverPct: 0,
          },
          realizeTaxesOnSwitch: true,
          soldFractionByAccount: { "acct-brokerage": 0.5 },
        },
      ],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2032 },
    });
    const result = runProjection(data);

    const switchYear = result.find((y) => y.year === 2030)!;
    const priorYear = result.find((y) => y.year === 2029)!;

    // The reinvestment realizes LTCG on the brokerage account in 2030.
    expect(switchYear.taxDetail!.capitalGains).toBeGreaterThan(0);
    // No other LTCG source: the year before the switch is zero.
    expect(priorYear.taxDetail!.capitalGains).toBe(0);
  });
});
