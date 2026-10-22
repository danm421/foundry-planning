import { describe, it, expect } from "vitest";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { Expense } from "@/engine/types";
import { applyMutations } from "../apply-mutations";
import {
  applyHeldChanges,
  entriesNaming,
  heldScenarioChanges,
  idsCreatedBy,
} from "../held-changes";
import { mutationKey, type HeldChangeMutation, type SolverMutation } from "../types";

const SAVE = "00000000-0000-4000-8000-0000000000b1";
const NEW_ID = "00000000-0000-4000-8000-0000000000a1";

function heldAdd(expense: Partial<Expense> & { id: string }): HeldChangeMutation {
  return {
    kind: "held-change",
    op: "add",
    targetKind: "expense",
    targetId: expense.id,
    payload: { name: "Boat", type: "other", annualAmount: 5000, startYear: 2030, endYear: 2040, growthRate: 0, ...expense },
    saveId: SAVE,
  };
}

describe("held-changes", () => {
  it("heldScenarioChanges keeps list order and skips controls", () => {
    const a = heldAdd({ id: NEW_ID });
    const b: HeldChangeMutation = { kind: "held-change", op: "remove", targetKind: "expense", targetId: "x", payload: null, saveId: SAVE };
    const list: SolverMutation[] = [a, { kind: "living-expense-scale", multiplier: 1.1 }, b];
    const out = heldScenarioChanges(list);
    expect(out.map((c) => [c.opType, c.targetId, c.orderIndex])).toEqual([
      ["add", NEW_ID, 0],
      ["remove", "x", 1],
    ]);
    expect(out[0]).toMatchObject({ id: `held:${mutationKey(a)}`, scenarioId: "held", toggleGroupId: null });
  });

  it("applyHeldChanges adds a held expense and applies a held edit to a base income", () => {
    const tree = buildClientData();
    const income = tree.incomes[0];
    const edit: HeldChangeMutation = {
      kind: "held-change",
      op: "edit",
      targetKind: "income",
      targetId: income.id,
      payload: { annualAmount: { from: income.annualAmount, to: 123_456 } },
      saveId: SAVE,
    };
    const out = applyHeldChanges(tree, [heldAdd({ id: NEW_ID }), edit]);
    expect(out.expenses.some((e) => e.id === NEW_ID)).toBe(true);
    expect(out.incomes.find((i) => i.id === income.id)?.annualAmount).toBe(123_456);
    expect(tree.expenses.some((e) => e.id === NEW_ID)).toBe(false);
  });

  it("applyHeldChanges returns the same tree when nothing is held", () => {
    const tree = buildClientData();
    expect(applyHeldChanges(tree, [{ kind: "living-expense-scale", multiplier: 1.1 }])).toBe(tree);
  });

  it("applyMutations ignores held-change", () => {
    const tree = buildClientData();
    const out = applyMutations(tree, [heldAdd({ id: NEW_ID })]);
    expect(out.expenses).toHaveLength(tree.expenses.length);
  });

  it("idsCreatedBy: held add → its id; account-upsert of a new id → id; of an existing account → []", () => {
    const tree = buildClientData();
    expect(idsCreatedBy(heldAdd({ id: NEW_ID }), tree)).toEqual([NEW_ID]);
    const existing = tree.accounts[0];
    expect(idsCreatedBy({ kind: "account-upsert", id: existing.id, value: existing }, tree)).toEqual([]);
    const fresh = { ...existing, id: NEW_ID };
    expect(idsCreatedBy({ kind: "account-upsert", id: NEW_ID, value: fresh }, tree)).toEqual([NEW_ID]);
    expect(idsCreatedBy({ kind: "account-upsert", id: NEW_ID, value: null }, tree)).toEqual([]);
    expect(idsCreatedBy({ kind: "living-expense-scale", multiplier: 1 }, tree)).toEqual([]);
  });

  it("entriesNaming finds a savings-rule-upsert whose rule names the account", () => {
    const tree = buildClientData();
    const rule = { ...tree.savingsRules[0], id: "rule-1", accountId: NEW_ID };
    const ruleM: SolverMutation = { kind: "savings-rule-upsert", id: "rule-1", value: rule };
    const other: SolverMutation = { kind: "living-expense-scale", multiplier: 1 };
    const keys = entriesNaming([ruleM, other], new Set([NEW_ID]));
    expect(keys).toEqual([mutationKey(ruleM)]);
    expect(entriesNaming([ruleM, other], new Set([NEW_ID]), mutationKey(ruleM))).toEqual([]);
  });
});
