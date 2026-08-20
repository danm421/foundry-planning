import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine";
import type { Account, ClientData, ClientInfo, Expense, Income } from "@/engine/types";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";

const PLAN_START = 2026;
const PLAN_END = 2027;
const SYNTH_ACCT = "synthetic-taxable-savings";

/**
 * 200k salary, 120k of fixed non-living costs, zero tax and zero inflation, so
 * the leftover before living is exactly 80k/yr. The living row absorbs, with a
 * $0 floor. `surplusSpendPct: 0` is the point of the fixture: it is the setting
 * under which the self-funding block's cash pool is zero today.
 */
function fixture(selfFundingTarget: number): ClientData {
  const client: ClientInfo = {
    firstName: "Solo", lastName: "Saver", dateOfBirth: "1980-01-01",
    retirementAge: 70, planEndAge: 90, filingStatus: "single",
  };

  const accounts: Account[] = [
    {
      id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
      titlingType: "jtwros", value: 25_000, basis: 25_000, growthRate: 0,
      rmdEnabled: false, isDefaultChecking: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    },
    {
      id: SYNTH_ACCT, name: "Hypothetical Additional Savings", category: "taxable",
      subType: "brokerage", titlingType: "jtwros", value: 0, basis: 0, growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    },
  ];

  const incomes: Income[] = [{
    id: "inc-salary", type: "salary", name: "Salary", annualAmount: 200_000,
    startYear: PLAN_START, endYear: PLAN_END, growthRate: 0, owner: "client",
  }];

  const expenses: Expense[] = [
    {
      id: "exp-living", type: "living", name: "Current Living Expenses",
      annualAmount: 0, startYear: PLAN_START, endYear: PLAN_END, growthRate: 0,
      absorbsRemainingCashFlow: true,
    },
    {
      id: "exp-other", type: "other", name: "Fixed costs", annualAmount: 120_000,
      startYear: PLAN_START, endYear: PLAN_END, growthRate: 0,
    },
  ];

  return {
    client,
    accounts,
    incomes,
    expenses,
    liabilities: [],
    savingsRules: [{
      id: "synthetic-rule", accountId: SYNTH_ACCT, annualAmount: selfFundingTarget,
      isDeductible: false, rothPercent: 0, fundFromExpenseReduction: true,
      startYear: PLAN_START, endYear: PLAN_END,
    }],
    withdrawalStrategy: [
      { accountId: SYNTH_ACCT, priorityOrder: 1, startYear: PLAN_START, endYear: PLAN_END },
    ],
    planSettings: {
      flatFederalRate: 0, flatStateRate: 0, inflationRate: 0,
      planStartYear: PLAN_START, planEndYear: PLAN_END,
      surplusSpendPct: 0,
      surplusSpendAllUntilRetirement: false,
    },
    familyMembers: [{
      id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
      firstName: "Solo", lastName: "Saver", dateOfBirth: "1980-01-01",
    }],
    giftEvents: [],
  };
}

describe("min-savings self-funding against an absorbing living row", () => {
  it("funds the hypothetical entirely from cash flow", () => {
    const y = runProjection(fixture(20_000))[0];
    expect(y.hypotheticalSavings?.contribution).toBeCloseTo(20_000, 0);
    expect(y.hypotheticalSavings?.fromCashFlow).toBeCloseTo(20_000, 0);
    // The floor is $0, so there is no living expense to cut — every dollar has
    // to come from the redirected spend or the contribution is unfundable.
    expect(y.hypotheticalSavings?.fromExpenseReduction).toBeCloseTo(0, 0);
  });

  it("shrinks the absorbed living expense by exactly the contribution", () => {
    const y = runProjection(fixture(20_000))[0];
    // Leftover was 80k; the hypothetical took 20k, so the row absorbs 60k.
    expect(y.expenses.living).toBeCloseTo(60_000, 0);
  });

  it("absorbs the whole 80k when there is no self-funding rule", () => {
    // The control: proves the 60k above is the contribution's effect and not a
    // fixture artefact.
    const y = runProjection(fixture(0))[0];
    expect(y.expenses.living).toBeCloseTo(80_000, 0);
  });
});
