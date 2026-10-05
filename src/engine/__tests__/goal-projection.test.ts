import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, ClientData, EntitySummary, Expense, Income } from "../types";

/**
 * The goal-funding step for goals other than education (spec
 * 2026-10-05-solver-goals-design). An Other expense marked as a goal, with a
 * savings account attached, draws its cost from that account the way an
 * education goal draws a 529. The fixture is isolated (no incomes / savings /
 * withdrawal strategy) so balances can be pinned exactly.
 */

const CLIENT_OWNER = [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];

const checking: Account = {
  id: "chk",
  name: "Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 100000,
  basis: 100000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: CLIENT_OWNER,
};

const fund = (value: number, overrides: Partial<Account> = {}): Account => ({
  id: "fund",
  name: "Car Fund",
  category: "cash",
  subType: "savings",
  titlingType: "jtwros",
  value,
  basis: value,
  growthRate: 0,
  rmdEnabled: false,
  owners: CLIENT_OWNER,
  ...overrides,
});

const car = (overrides: Partial<Expense> = {}): Expense => ({
  id: "car",
  type: "other",
  name: "New car",
  annualAmount: 60000,
  startYear: 2026,
  endYear: 2026,
  growthRate: 0,
  isGoal: true,
  dedicatedAccountIds: ["fund"],
  payShortfallOutOfPocket: true,
  ...overrides,
});

function makeData(accounts: Account[], expenses: Expense[], extra: Partial<ClientData> = {}): ClientData {
  const base = buildClientData({
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2027 },
  });
  return {
    ...base,
    accounts,
    incomes: [],
    expenses,
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    ...extra,
  };
}

describe("goal funding: Other goals", () => {
  it("an Other goal with no savings account projects exactly like a plain expense", () => {
    const plain = runProjection(makeData([checking], [car({ isGoal: false, dedicatedAccountIds: [] })]));
    const goal = runProjection(makeData([checking], [car({ dedicatedAccountIds: [] })]));
    expect(goal).toEqual(plain);
  });

  it("draws an Other goal from its savings account and records a goal row", () => {
    const y0 = runProjection(makeData([checking, fund(80000)], [car()]))[0];
    const row = y0.goals?.find((g) => g.goalId === "car");
    expect(row).toMatchObject({
      kind: "other",
      goalExpense: 60000,
      dedicatedWithdrawal: 60000,
      outOfPocketWithdrawal: 0,
      shortfall: 0,
    });
    expect(y0.accountLedgers["fund"].endingValue).toBeCloseTo(20000, 6);
    expect(y0.accountLedgers["fund"].entries.some((e) => e.label === "Goal: New car")).toBe(true);
    // The draw paid the bill; household checking is untouched.
    expect(y0.accountLedgers["chk"].endingValue).toBeCloseTo(100000, 6);
  });

  it("skips a 529 linked to an Other goal and pays the goal as a plain expense", () => {
    const p529: Account = {
      ...fund(80000),
      id: "p529",
      name: "529 Plan",
      category: "education_savings",
      subType: "529",
    };
    const y0 = runProjection(makeData([checking, p529], [car({ dedicatedAccountIds: ["p529"] })]))[0];
    expect(y0.goals ?? []).toEqual([]);
    expect(y0.accountLedgers["p529"].endingValue).toBeCloseTo(80000, 6);
    expect(y0.expenses.bySource["car"]).toBeCloseTo(60000, 6);
    expect(y0.accountLedgers["chk"].endingValue).toBeCloseTo(40000, 6);
  });

  it("books an Other goal's taxable draw under goal_capital, not education_capital", () => {
    const brk: Account = {
      id: "brk",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 100000,
      basis: 40000,
      growthRate: 0,
      rmdEnabled: false,
      owners: CLIENT_OWNER,
    };
    const y0 = runProjection(makeData([checking, brk], [car({ dedicatedAccountIds: ["brk"] })]))[0];
    expect(y0.taxDetail!.bySource["goal_capital:car"]?.amount ?? 0).toBeGreaterThan(0);
    expect(y0.taxDetail!.bySource["education_capital:car"]).toBeUndefined();
  });

  it("leaves an entity-owned Other goal as a plain expense its owner pays, never drawing the savings account", () => {
    // A business- or entity-owned expense is netted against its owner's income
    // (entity-flows / business year-flow); drawing the savings account too
    // would charge the goal twice.
    const y0 = runProjection(
      makeData([checking, fund(80000)], [car({ ownerEntityId: "llc" })], {
        entities: [{ id: "llc", name: "Family LLC", entityType: "llc", includeInPortfolio: false, isGrantor: false }],
      }),
    )[0];
    expect(y0.goals ?? []).toEqual([]);
    expect(y0.accountLedgers["fund"].endingValue).toBeCloseTo(80000, 6);
    expect(y0.accountLedgers["fund"].entries.some((e) => e.sourceId === "car")).toBe(false);
  });
});

describe("goal funding: who owns the account decides what Cash Flow shows", () => {
  const salary: Income = {
    id: "sal",
    type: "salary",
    name: "Salary",
    annualAmount: 200000,
    startYear: 2026,
    endYear: 2027,
    growthRate: 0,
    owner: "client",
  };
  const living: Expense = {
    id: "liv",
    type: "living",
    name: "Living",
    annualAmount: 50000,
    startYear: 2026,
    endYear: 2027,
    growthRate: 0,
  };
  // Income well above spending, half the surplus spent: a year with a real
  // discretionary split the goal must not disturb.
  const withSurplus = (accounts: Account[], expenses: Expense[]) =>
    makeData(accounts, expenses, {
      incomes: [salary],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2027, surplusSpendPct: 0.5 },
    });

  it("shows a household draw as a withdrawal and the cost as an expense, leaving the surplus split alone", () => {
    const without = runProjection(withSurplus([checking, fund(80000)], [living]))[0];
    const withGoal = runProjection(withSurplus([checking, fund(80000)], [living, car()]))[0];

    expect(withGoal.withdrawals.byAccount["fund"]).toBeCloseTo(60000, 6);
    expect(withGoal.withdrawals.total).toBeCloseTo(without.withdrawals.total + 60000, 6);
    expect(withGoal.expenses.bySource["car"]).toBeCloseTo(60000, 6);
    expect(withGoal.expenses.other).toBeCloseTo(without.expenses.other + 60000, 6);
    expect(withGoal.goals!.find((g) => g.goalId === "car")!.householdWithdrawal).toBeCloseTo(60000, 6);

    // The surplus invariant (spec §1): the household's other spending and saving don't move.
    expect(without.expenses.discretionary).toBeGreaterThan(0);
    expect(withGoal.expenses.discretionary).toBeCloseTo(without.expenses.discretionary, 6);
    expect(withGoal.accountLedgers["chk"].endingValue).toBeCloseTo(without.accountLedgers["chk"].endingValue, 6);
    expect(withGoal.accountLedgers["fund"].endingValue).toBeCloseTo(
      without.accountLedgers["fund"].endingValue - 60000,
      6,
    );
  });

  it("shows an education goal paid from a household brokerage too, without moving any other balance", () => {
    const brk: Account = { ...fund(80000), id: "brk", name: "Brokerage", category: "taxable", subType: "brokerage" };
    const college: Expense = {
      id: "edu",
      type: "education",
      name: "College",
      annualAmount: 30000,
      startYear: 2026,
      endYear: 2026,
      growthRate: 0,
      dedicatedAccountIds: ["brk"],
      payShortfallOutOfPocket: false,
    };
    const without = runProjection(withSurplus([checking, brk], [living]))[0];
    const withGoal = runProjection(withSurplus([checking, brk], [living, college]))[0];

    expect(withGoal.withdrawals.byAccount["brk"]).toBeCloseTo(30000, 6);
    expect(withGoal.expenses.bySource["edu"]).toBeCloseTo(30000, 6);
    expect(withGoal.expenses.discretionary).toBeCloseTo(without.expenses.discretionary, 6);
    expect(withGoal.accountLedgers["chk"].endingValue).toBeCloseTo(without.accountLedgers["chk"].endingValue, 6);
  });

  it("keeps a 529 off household Cash Flow even when its owner rows name the client", () => {
    const p529: Account = { ...fund(50000), id: "p529", name: "529", category: "education_savings", subType: "529" };
    const college: Expense = {
      id: "edu",
      type: "education",
      name: "College",
      annualAmount: 30000,
      startYear: 2026,
      endYear: 2026,
      growthRate: 0,
      dedicatedAccountIds: ["p529"],
      payShortfallOutOfPocket: false,
    };
    const y0 = runProjection(makeData([checking, p529], [college]))[0];
    expect(y0.withdrawals.total).toBe(0);
    expect(y0.expenses.bySource["edu"]).toBeUndefined();
    expect(y0.goals!.find((g) => g.goalId === "edu")!.householdWithdrawal).toBe(0);
  });

  it("keeps an entity-owned account off household Cash Flow", () => {
    const TRUST_ID = "trust-1";
    const trust: EntitySummary = {
      id: TRUST_ID,
      name: "Family Trust",
      entityType: "trust",
      trustSubType: "irrevocable",
      isIrrevocable: true,
      isGrantor: false,
      includeInPortfolio: false,
      accessibleToClient: false,
      grantor: "client",
    };
    const trustFund = fund(80000, { owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }] });
    const y0 = runProjection(makeData([checking, trustFund], [car()], { entities: [trust] }))[0];

    expect(y0.withdrawals.byAccount["fund"]).toBeUndefined();
    expect(y0.expenses.bySource["car"]).toBeUndefined();
    expect(y0.goals!.find((g) => g.goalId === "car")).toMatchObject({
      dedicatedWithdrawal: 60000,
      householdWithdrawal: 0,
    });
  });

  it("with the toggle on, the household draw and the out-of-pocket rest are both expenses", () => {
    const y0 = runProjection(makeData([checking, fund(20000)], [car()]))[0];
    expect(y0.withdrawals.byAccount["fund"]).toBeCloseTo(20000, 6);
    expect(y0.expenses.bySource["car"]).toBeCloseTo(60000, 6);
    expect(y0.accountLedgers["chk"].endingValue).toBeCloseTo(60000, 6); // 100k − 40k out of pocket
  });

  it("with the toggle off, leaves what the account can't cover unfunded and off the expense line", () => {
    const y0 = runProjection(makeData([checking, fund(20000)], [car({ payShortfallOutOfPocket: false })]))[0];
    expect(y0.goals!.find((g) => g.goalId === "car")).toMatchObject({
      dedicatedWithdrawal: 20000,
      householdWithdrawal: 20000,
      outOfPocketWithdrawal: 0,
      shortfall: 40000,
    });
    expect(y0.expenses.bySource["car"]).toBeCloseTo(20000, 6);
    expect(y0.accountLedgers["chk"].endingValue).toBeCloseTo(100000, 6);
  });

  it("never lets a deficit year's withdrawals overdraw a goal account the goal just drew", () => {
    const brk: Account = { ...fund(100000), id: "brk", name: "Brokerage", category: "taxable", subType: "brokerage" };
    const bigLiving: Expense = { ...living, annualAmount: 80000 };
    const data = makeData(
      [{ ...checking, value: 0, basis: 0 }, brk],
      [bigLiving, car({ dedicatedAccountIds: ["brk"] })],
      { withdrawalStrategy: [{ accountId: "brk", priorityOrder: 1, startYear: 2026, endYear: 2027 }] },
    );
    const y0 = runProjection(data)[0];
    expect(y0.goals!.find((g) => g.goalId === "car")!.dedicatedWithdrawal).toBeCloseTo(60000, 6);
    // 100k − 60k for the car leaves 40k; the gap-fill may take at most that.
    expect(y0.accountLedgers["brk"].endingValue).toBeGreaterThanOrEqual(-0.01);
  });
});
