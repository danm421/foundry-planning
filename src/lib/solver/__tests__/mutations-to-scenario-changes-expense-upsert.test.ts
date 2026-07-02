import { describe, it, expect } from "vitest";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import type { ClientData, Expense } from "@/engine/types";

const goal: Expense = {
  id: "goal-1", type: "education", name: "College — Emma", annualAmount: 30_000,
  startYear: 2032, endYear: 2035, growthRate: 0.05,
  dedicatedAccountIds: ["529-emma"], payShortfallOutOfPocket: false,
} as Expense;

function tree(expenses: Expense[]): ClientData {
  return { expenses, accounts: [], savingsRules: [], incomes: [], client: {} } as unknown as ClientData;
}

describe("mutationsToScenarioChanges — expense-upsert", () => {
  it("emits an add draft for a new goal", () => {
    const drafts = mutationsToScenarioChanges(tree([]), "client-1", [
      { kind: "expense-upsert", id: "goal-1", value: goal },
    ]);
    const d = drafts.find((x) => x.targetKind === "expense");
    expect(d?.opType).toBe("add");
    expect(d?.targetId).toBe("goal-1");
  });

  it("emits a remove draft when value is null for an existing goal", () => {
    const drafts = mutationsToScenarioChanges(tree([goal]), "client-1", [
      { kind: "expense-upsert", id: "goal-1", value: null },
    ]);
    const d = drafts.find((x) => x.targetKind === "expense");
    expect(d?.opType).toBe("remove");
  });
});
