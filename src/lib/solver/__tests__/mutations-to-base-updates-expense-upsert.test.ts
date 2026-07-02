// src/lib/solver/__tests__/mutations-to-base-updates-expense-upsert.test.ts
import { describe, it, expect } from "vitest";
import { mutationsToBaseUpdates } from "@/lib/solver/mutations-to-base-updates";
import type { ClientData, Expense } from "@/engine/types";

const goal: Expense = {
  id: "goal-1", type: "education", name: "College — Emma", annualAmount: 30_000,
  startYear: 2032, endYear: 2035, growthRate: 0.05, dedicatedAccountIds: ["529-emma"],
  payShortfallOutOfPocket: false,
};
const tree = (expenses: Expense[]) =>
  ({ expenses, accounts: [], savingsRules: [] } as unknown as ClientData);

describe("mutationsToBaseUpdates — expense-upsert", () => {
  it("classifies a new goal as an insert", () => {
    const out = mutationsToBaseUpdates(tree([]), [{ kind: "expense-upsert", id: "goal-1", value: goal }]);
    expect(out.expenseInserts.map((e) => e.id)).toContain("goal-1");
    expect(out.expenseFullUpdates).toHaveLength(0);
  });

  it("classifies an existing goal as a full update", () => {
    const out = mutationsToBaseUpdates(tree([goal]), [
      { kind: "expense-upsert", id: "goal-1", value: { ...goal, annualAmount: 40_000 } },
    ]);
    expect(out.expenseFullUpdates.map((e) => e.id)).toContain("goal-1");
    expect(out.expenseInserts).toHaveLength(0);
  });

  it("classifies a null value against an existing goal as a remove", () => {
    const out = mutationsToBaseUpdates(tree([goal]), [{ kind: "expense-upsert", id: "goal-1", value: null }]);
    expect(out.expenseRemoves).toContain("goal-1");
  });
});
