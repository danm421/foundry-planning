import { describe, it, expect } from "vitest";
import { applyMutations } from "@/lib/solver/apply-mutations";
import type { ClientData, Expense } from "@/engine/types";

const goal: Expense = {
  id: "goal-1",
  type: "education",
  name: "College — Emma",
  annualAmount: 30_000,
  startYear: 2032,
  endYear: 2035,
  growthRate: 0.05,
  dedicatedAccountIds: ["529-emma"],
  payShortfallOutOfPocket: false,
};

function baseTree(expenses: Expense[]): ClientData {
  // Minimal ClientData — only .expenses is exercised by the expense-upsert
  // case itself. The remaining fields are required because applyMutations
  // unconditionally runs post-processing (premium-gift synthesis +
  // resolveRefYears) after the mutation loop, regardless of mutation kind —
  // mirrors the fixture convention in apply-mutations-upsert.test.ts.
  return {
    client: {} as never,
    accounts: [],
    savingsRules: [],
    incomes: [],
    expenses,
    planSettings: {} as ClientData["planSettings"],
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

describe("applyMutations — expense-upsert", () => {
  it("adds a new education goal", () => {
    const out = applyMutations(baseTree([]), [
      { kind: "expense-upsert", id: "goal-1", value: goal },
    ]);
    expect(out.expenses).toHaveLength(1);
    expect(out.expenses[0].name).toBe("College — Emma");
  });

  it("replaces an existing goal by id", () => {
    const out = applyMutations(baseTree([goal]), [
      { kind: "expense-upsert", id: "goal-1", value: { ...goal, annualAmount: 40_000 } },
    ]);
    expect(out.expenses).toHaveLength(1);
    expect(out.expenses[0].annualAmount).toBe(40_000);
  });

  it("removes a goal when value is null", () => {
    const out = applyMutations(baseTree([goal]), [
      { kind: "expense-upsert", id: "goal-1", value: null },
    ]);
    expect(out.expenses).toHaveLength(0);
  });
});
