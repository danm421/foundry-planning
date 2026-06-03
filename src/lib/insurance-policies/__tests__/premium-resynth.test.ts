// Regression tests for `withSynthesizedPremiums` — the post-overlay premium
// re-derivation used by the scenario loader.
//
// Premium synthesis historically ran on the BASE accounts inside
// `loadClientData`, so the scenario overlay (which adds / removes / edits
// life-insurance accounts) sat on top of already-synthesized premiums:
//   • scenario-ADDED LI policy   → no premium drag (portfolio over-stated)
//   • scenario-REMOVED LI policy → orphan synthetic premium (savings drained)
//   • scenario-EDITED premium    → stale premium amount / horizon
//
// `withSynthesizedPremiums` is the idempotent strip-and-re-derive that runs on
// the EFFECTIVE tree so premiums always match the current account set.

import { describe, it, expect } from "vitest";
import {
  synthesizePremiumExpenses,
  withSynthesizedPremiums,
} from "../premium-expense";
import type {
  Account,
  ClientData,
  Expense,
  LifeInsuranceCashValueScheduleRow,
} from "@/engine/types";

function liAccount(id: string, premiumAmount: number): Account {
  return {
    id,
    name: `${id} policy`,
    category: "life_insurance",
    subType: "permanent",
    value: 0,
    basis: 0,
    rothValue: 0,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: false,
    annualPropertyTax: 0,
    propertyTaxGrowthRate: 0,
    titlingType: "jtwros",
    owners: [],
    businessType: null,
    distributionPolicyPercent: null,
    businessTaxTreatment: null,
    parentAccountId: null,
    insuredPerson: "client",
    // premiumYears wins over policyType, so the end-year is deterministic
    // without needing birth-year / life-expectancy inputs.
    lifeInsurance: {
      premiumAmount,
      premiumYears: 10,
      policyType: "permanent",
    } as unknown as Account["lifeInsurance"],
  } as Account;
}

/**
 * Builds a full life-insurance `Account` with a `lifeInsurance` policy,
 * passing `premiumScheduleMode` / `cashValueSchedule` through and defaulting
 * the other two schedule-mode flags to "off". Used for the direct
 * `synthesizePremiumExpenses` (input-shape) tests.
 */
function makeLifeAccount(opts: {
  id: string;
  premiumAmount: number;
  premiumScheduleMode?: "off" | "scheduled";
  cashValueSchedule?: LifeInsuranceCashValueScheduleRow[];
}): Account {
  return {
    id: opts.id,
    name: opts.id,
    category: "life_insurance",
    subType: "permanent",
    value: 0,
    basis: 0,
    rothValue: 0,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: false,
    annualPropertyTax: 0,
    propertyTaxGrowthRate: 0,
    titlingType: "jtwros",
    owners: [],
    businessType: null,
    distributionPolicyPercent: null,
    businessTaxTreatment: null,
    parentAccountId: null,
    insuredPerson: "client",
    lifeInsurance: {
      premiumAmount: opts.premiumAmount,
      premiumYears: 10,
      policyType: "permanent",
      premiumScheduleMode: opts.premiumScheduleMode ?? "off",
      deathBenefitScheduleMode: "off",
      incomeScheduleMode: "off",
      cashValueSchedule: opts.cashValueSchedule ?? [],
    } as unknown as Account["lifeInsurance"],
  } as Account;
}

function tree(accounts: Account[], expenses: Expense[]): ClientData {
  return {
    client: {
      firstName: "A",
      lastName: "B",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      retirementMonth: 1,
      planEndAge: 95,
      lifeExpectancy: 90,
      spouseName: null,
      spouseDob: null,
      spouseRetirementAge: undefined,
      spouseRetirementMonth: undefined,
      spouseLifeExpectancy: null,
      filingStatus: "single",
    },
    accounts,
    expenses,
    incomes: [],
  } as unknown as ClientData;
}

const policyExpenses = (t: ClientData): Expense[] =>
  t.expenses.filter((e) => e.source === "policy");

describe("withSynthesizedPremiums", () => {
  it("synthesizes a premium for a life-insurance account that has none yet (scenario-add)", () => {
    const result = withSynthesizedPremiums(tree([liAccount("li1", 5000)], []));
    const premiums = policyExpenses(result);
    expect(premiums).toHaveLength(1);
    expect(premiums[0]).toMatchObject({
      id: "premium-li1",
      source: "policy",
      annualAmount: 5000,
      sourcePolicyAccountId: "li1",
    });
  });

  it("drops an orphan policy premium whose account no longer exists (scenario-remove)", () => {
    const orphan: Expense = {
      id: "premium-li1",
      type: "insurance",
      name: "li1 policy premium",
      annualAmount: 5000,
      startYear: 2026,
      endYear: 2035,
      growthRate: 0,
      source: "policy",
      sourcePolicyAccountId: "li1",
    };
    const result = withSynthesizedPremiums(tree([], [orphan]));
    expect(policyExpenses(result)).toHaveLength(0);
  });

  it("re-derives the premium amount after an edit, without duplicating (scenario-edit)", () => {
    const stale: Expense = {
      id: "premium-li1",
      type: "insurance",
      name: "li1 policy premium",
      annualAmount: 5000,
      startYear: 2026,
      endYear: 2035,
      growthRate: 0,
      source: "policy",
      sourcePolicyAccountId: "li1",
    };
    const result = withSynthesizedPremiums(tree([liAccount("li1", 7000)], [stale]));
    const premiums = policyExpenses(result);
    expect(premiums).toHaveLength(1);
    expect(premiums[0].annualAmount).toBe(7000);
  });

  it("preserves non-policy expenses", () => {
    const living: Expense = {
      id: "exp1",
      type: "living",
      name: "Living",
      annualAmount: 40000,
      startYear: 2026,
      endYear: 2060,
      growthRate: 0.03,
      source: "manual",
    };
    const result = withSynthesizedPremiums(tree([liAccount("li1", 5000)], [living]));
    expect(result.expenses.find((e) => e.id === "exp1")).toMatchObject({ annualAmount: 40000 });
    expect(policyExpenses(result)).toHaveLength(1);
  });
});

describe("synthesizePremiumExpenses — scheduled premium mode", () => {
  it("uses the schedule's premium column when premiumScheduleMode is scheduled", () => {
    const acct = makeLifeAccount({
      id: "pol-1",
      premiumAmount: 0, // scalar ignored
      premiumScheduleMode: "scheduled",
      cashValueSchedule: [
        { year: 2026, premiumAmount: 87_216 },
        { year: 2027, premiumAmount: 87_216 },
        { year: 2028, premiumAmount: 50_000 },
      ],
    });

    const [exp] = synthesizePremiumExpenses({
      currentYear: 2026,
      accounts: [acct],
      clientBirthYear: 1970,
      spouseBirthYear: null,
      lifeExpectancyClient: 90,
      lifeExpectancySpouse: null,
      clientRetirementAge: 65,
      spouseRetirementAge: null,
    });

    expect(exp.scheduleOverrides).toEqual({ 2026: 87_216, 2027: 87_216, 2028: 50_000 });
    expect(exp.startYear).toBe(2026);
    expect(exp.endYear).toBe(2028);
    expect(exp.source).toBe("policy");
    expect(exp.sourcePolicyAccountId).toBe("pol-1");
  });
});
