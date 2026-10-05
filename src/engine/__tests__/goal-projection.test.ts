import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, ClientData, Expense } from "../types";

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
