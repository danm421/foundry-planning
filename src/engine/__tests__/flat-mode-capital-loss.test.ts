import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { calculateTaxYearFlat, makeEmptyTaxParams } from "../tax";
import { buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, ClientData, PlanSettings } from "../types";

/**
 * C1 — flat tax mode must run the same §1222 / §1211(b) / §1212(b) machinery
 * the bracket path runs.
 *
 * Before this fix `calculateTaxYearFlat` was `Math.max(0, taxableIncome) *
 * rate` with `capitalLoss.deduction` hardcoded to 0, so a realized capital
 * loss offset ordinary income dollar-for-dollar with no cap. Flat is the
 * DEFAULT tax mode, so this hit every plan that had not opted into brackets.
 */

const FED = 0.24;
const STATE = 0.05;
const COMBINED = FED + STATE;

const checking: Account = {
  id: "chk",
  name: "Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const underwaterBrokerage: Account = {
  id: "asset",
  name: "Underwater Brokerage",
  category: "taxable",
  subType: "brokerage",
  titlingType: "jtwros",
  value: 500_000,
  basis: 1_000_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

function flatPlan(over: Partial<PlanSettings> = {}): PlanSettings {
  return {
    flatFederalRate: FED,
    flatStateRate: STATE,
    inflationRate: 0,
    planStartYear: 2026,
    planEndYear: 2026,
    taxEngineMode: "flat",
    taxInflationRate: 0,
    ...over,
  } as PlanSettings;
}

function salaryOnlyPlan(over: Partial<ClientData> = {}): ClientData {
  return buildClientData({
    accounts: [checking, underwaterBrokerage],
    incomes: [
      {
        id: "inc-salary",
        name: "Salary",
        type: "salary",
        owner: "client",
        annualAmount: 400_000,
        growthRate: 0,
        startYear: 2026,
        endYear: 2040,
      } as ClientData["incomes"][number],
    ],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: flatPlan(),
    ...over,
  });
}

describe("flat mode — §1211(b) cap on the capital-loss ordinary offset", () => {
  it("caps a $500k realized loss at $3,000 against $400k of salary", () => {
    const y = runProjection(
      salaryOnlyPlan({
        assetTransactions: [
          {
            id: "tx-loss",
            name: "Sell underwater",
            type: "sell",
            year: 2026,
            accountId: "asset",
            overrideSaleValue: 500_000,
            overrideBasis: 1_000_000,
            proceedsAccountId: "chk",
          },
        ],
      }),
    )[0];

    // Pre-fix: taxableIncome = 400,000 − 500,000 = −100,000 → floored to 0 → $0 tax.
    // Post-fix: 400,000 − 3,000 = 397,000 taxed at 29% = $115,130.
    expect(y.taxResult!.flow.totalTax).toBeCloseTo(397_000 * COMBINED, 2);
    expect(y.taxResult!.capitalLoss.deduction).toBe(3_000);
    // §1212(b): the unabsorbed 497,000 carries forward.
    expect(y.taxDetail!.capitalLossCarryforward).toEqual({
      shortTerm: 0,
      longTerm: 497_000,
    });
  });

  it("draws the carryforward down $3,000/yr in the FOLLOWING flat-mode year", () => {
    const years = runProjection(
      salaryOnlyPlan({
        planSettings: flatPlan({ planEndYear: 2027 }),
        assetTransactions: [
          {
            id: "tx-loss",
            name: "Sell underwater",
            type: "sell",
            year: 2026,
            accountId: "asset",
            overrideSaleValue: 500_000,
            overrideBasis: 1_000_000,
            proceedsAccountId: "chk",
          },
        ],
      }),
    );

    expect(years[1].taxDetail!.capitalLossCarryforward).toEqual({
      shortTerm: 0,
      longTerm: 494_000,
    });
    expect(years[1].taxResult!.capitalLoss.deduction).toBe(3_000);
    expect(years[1].taxResult!.flow.totalTax).toBeCloseTo(397_000 * COMBINED, 2);
  });
});

describe("calculateTaxYearFlat — netting unit behaviour", () => {
  const base = {
    flatFederalRate: FED,
    flatStateRate: STATE,
    taxParams: makeEmptyTaxParams(2026),
  };

  it("applies the $1,500 MFS limit, not $3,000", () => {
    const r = calculateTaxYearFlat({
      ...base,
      taxableIncome: 200_000 - 50_000,
      longTermCapitalGains: -50_000,
      shortTermCapitalGains: 0,
      filingStatus: "married_separate",
      capitalLossCarryforwardIn: { shortTerm: 0, longTerm: 0 },
    });
    expect(r.capitalLoss.deduction).toBe(1_500);
    expect(r.flow.taxableIncome).toBe(198_500);
    expect(r.capitalLoss.carryforwardOut).toEqual({ shortTerm: 0, longTerm: 48_500 });
  });

  it("absorbs SHORT-term loss first per §1212(b)", () => {
    const r = calculateTaxYearFlat({
      ...base,
      taxableIncome: 200_000 - 5_000 - 20_000,
      longTermCapitalGains: -20_000,
      shortTermCapitalGains: -5_000,
      filingStatus: "married_joint",
      capitalLossCarryforwardIn: { shortTerm: 0, longTerm: 0 },
    });
    expect(r.capitalLoss.deduction).toBe(3_000);
    // 5,000 ST loss absorbs the whole 3,000 deduction; LT is untouched.
    expect(r.capitalLoss.carryforwardOut).toEqual({ shortTerm: 2_000, longTerm: 20_000 });
  });

  it("is byte-identical to the pre-fix result when there is no capital activity", () => {
    const r = calculateTaxYearFlat({
      ...base,
      taxableIncome: 200_000,
      longTermCapitalGains: 0,
      shortTermCapitalGains: 0,
      filingStatus: "married_joint",
      capitalLossCarryforwardIn: { shortTerm: 0, longTerm: 0 },
    });
    expect(r.flow.taxableIncome).toBe(200_000);
    expect(r.flow.totalTax).toBeCloseTo(200_000 * COMBINED, 6);
    expect(r.capitalLoss.deduction).toBe(0);
    expect(r.capitalLoss.carryforwardOut).toEqual({ shortTerm: 0, longTerm: 0 });
  });

  it("leaves taxable income untouched when the year has GAINS and no carryforward", () => {
    const r = calculateTaxYearFlat({
      ...base,
      taxableIncome: 200_000,
      longTermCapitalGains: 60_000,
      shortTermCapitalGains: 10_000,
      filingStatus: "married_joint",
      capitalLossCarryforwardIn: { shortTerm: 0, longTerm: 0 },
    });
    expect(r.flow.taxableIncome).toBe(200_000);
    expect(r.capitalLoss.deduction).toBe(0);
    // Knock-on (d): the income block reports the netted figures rather than
    // stub zeros, and `ordinaryIncome` stays the non-LT residual so the
    // "Ordinary Income" column (ordinaryIncome − shortCapitalGains) is >= 0.
    expect(r.income.capitalGains).toBe(60_000);
    expect(r.income.shortCapitalGains).toBe(10_000);
    expect(r.income.ordinaryIncome).toBe(140_000);
  });
});
