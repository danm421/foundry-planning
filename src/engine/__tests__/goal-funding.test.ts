import { describe, it, expect } from "vitest";
import {
  computeGoalDraw,
  is529Account,
  canHaveGoalFunding,
  goalDrawAccountIds,
  isFundedGoal,
} from "../goals/goal-funding";

// A trivial categorizer: cash/529 → basisReturn; else ordinaryIncome.
const categorize = (id: string, amount: number) =>
  id === "tax" ? { ordinaryIncome: amount, capitalGains: 0, basisReturn: 0, earlyWithdrawalPenalty: 0 }
               : { ordinaryIncome: 0, capitalGains: 0, basisReturn: amount, earlyWithdrawalPenalty: 0 };

describe("computeGoalDraw", () => {
  it("draws dedicated accounts in order, caps at goal cost", () => {
    const r = computeGoalDraw({
      goalCost: 25000,
      dedicatedAccountIds: ["a1", "a2"],
      balances: { a1: 10000, a2: 40000 },
      categorize,
    });
    expect(r.draws.map((d) => [d.accountId, d.amount])).toEqual([["a1", 10000], ["a2", 15000]]);
    expect(r.dedicatedWithdrawal).toBe(25000);
    expect(r.shortfall).toBe(0);
  });

  it("shortfall when dedicated funds are insufficient", () => {
    const r = computeGoalDraw({
      goalCost: 25000,
      dedicatedAccountIds: ["a1"],
      balances: { a1: 10000 },
      categorize,
    });
    expect(r.dedicatedWithdrawal).toBe(10000);
    expect(r.shortfall).toBe(15000);
  });

  it("aggregates taxable components across draws", () => {
    const r = computeGoalDraw({
      goalCost: 30000,
      dedicatedAccountIds: ["free", "tax"],
      balances: { free: 20000, tax: 20000 },
      categorize,
    });
    expect(r.dedicatedWithdrawal).toBe(30000);
    expect(r.ordinaryIncome).toBe(10000); // 10k drawn from "tax"
    expect(r.shortfall).toBe(0);
  });

  it("no dedicated accounts → full shortfall, no draws", () => {
    const r = computeGoalDraw({ goalCost: 5000, dedicatedAccountIds: [], balances: {}, categorize });
    expect(r.draws).toEqual([]);
    expect(r.dedicatedWithdrawal).toBe(0);
    expect(r.shortfall).toBe(5000);
  });
});

describe("goal-funding predicates", () => {
  const accounts = new Map([
    ["p529", { category: "education_savings", subType: "529" }],
    ["legacy529", { category: "taxable", subType: "529" }],
    ["brk", { category: "taxable", subType: "brokerage" }],
  ]);

  it("is529Account: the education_savings category, or a 529 sub-type filed elsewhere", () => {
    expect(is529Account({ category: "education_savings", subType: "529" })).toBe(true);
    expect(is529Account({ category: "taxable", subType: "529" })).toBe(true);
    expect(is529Account({ category: "taxable", subType: "brokerage" })).toBe(false);
  });

  it("canHaveGoalFunding: education, or an Other expense marked as a goal", () => {
    expect(canHaveGoalFunding({ type: "education" })).toBe(true);
    expect(canHaveGoalFunding({ type: "other", isGoal: true })).toBe(true);
    expect(canHaveGoalFunding({ type: "other" })).toBe(false);
    expect(canHaveGoalFunding({ type: "living", isGoal: true })).toBe(false);
    expect(canHaveGoalFunding({ type: "insurance", isGoal: true })).toBe(false);
  });

  it("goalDrawAccountIds keeps every link on an education goal", () => {
    expect(goalDrawAccountIds({ type: "education", dedicatedAccountIds: ["p529", "brk"] }, accounts))
      .toEqual(["p529", "brk"]);
  });

  it("goalDrawAccountIds drops 529s and unknown accounts from any other goal", () => {
    expect(
      goalDrawAccountIds({ type: "other", dedicatedAccountIds: ["p529", "legacy529", "gone", "brk"] }, accounts),
    ).toEqual(["brk"]);
  });

  it("isFundedGoal: every education goal; an Other goal only with a drawable account", () => {
    expect(isFundedGoal({ type: "education" }, accounts)).toBe(true);
    expect(isFundedGoal({ type: "other", isGoal: true, dedicatedAccountIds: ["brk"] }, accounts)).toBe(true);
    expect(isFundedGoal({ type: "other", isGoal: true, dedicatedAccountIds: [] }, accounts)).toBe(false);
    expect(isFundedGoal({ type: "other", isGoal: true, dedicatedAccountIds: ["p529"] }, accounts)).toBe(false);
    expect(isFundedGoal({ type: "other", isGoal: false, dedicatedAccountIds: ["brk"] }, accounts)).toBe(false);
    expect(isFundedGoal({ type: "living", isGoal: true, dedicatedAccountIds: ["brk"] }, accounts)).toBe(false);
  });

  it("isFundedGoal: a business- or entity-owned Other goal stays a plain expense; education is unchanged", () => {
    const other = { type: "other", isGoal: true, dedicatedAccountIds: ["brk"] };
    expect(isFundedGoal({ ...other, ownerAccountId: "biz" }, accounts)).toBe(false);
    expect(isFundedGoal({ ...other, ownerEntityId: "t1" }, accounts)).toBe(false);
    expect(isFundedGoal({ type: "education", ownerAccountId: "biz" }, accounts)).toBe(true);
  });
});
