import { describe, it, expect } from "vitest";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { ClientData, Expense } from "@/engine/types";
import { applyHeldChanges } from "../held-changes";
import { foldControlsIntoHeldAdds } from "../held-save";
import type { HeldChangeMutation, SolverMutation } from "../types";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const SAVE = "00000000-0000-4000-8000-0000000000b1";
const E = "00000000-0000-4000-8000-0000000000e1";

function heldAdd(expense: Partial<Expense>): HeldChangeMutation {
  return {
    kind: "held-change",
    op: "add",
    targetKind: "expense",
    targetId: E,
    payload: { id: E, name: "Boat", type: "other", annualAmount: 5000, startYear: 2030, endYear: 2040, growthRate: 0, ...expense },
    saveId: SAVE,
  };
}

const withHeld = (tree: ClientData, mutations: SolverMutation[]) => applyHeldChanges(tree, mutations);

describe("foldControlsIntoHeldAdds", () => {
  it("folds a control on a held add into the insert", () => {
    const add = heldAdd({});
    const control: SolverMutation = { kind: "expense-annual-amount", expenseId: E, annualAmount: 6000 };
    const mutations = [add, control];
    const { held, controls } = foldControlsIntoHeldAdds(withHeld(buildClientData(), mutations), CLIENT, mutations);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ opType: "add", targetId: E });
    expect((held[0].payload as Expense).annualAmount).toBe(6000);
    expect(controls).toEqual([]);
  });

  it("a control on a base item is left alone", () => {
    const add = heldAdd({});
    const control: SolverMutation = { kind: "expense-annual-amount", expenseId: "exp-insurance", annualAmount: 7000 };
    const mutations = [add, control];
    const { held, controls } = foldControlsIntoHeldAdds(withHeld(buildClientData(), mutations), CLIENT, mutations);
    expect((held[0].payload as Expense).annualAmount).toBe(5000);
    expect(controls).toEqual([control]);
  });

  it("a control touching a held add and a base row folds its part and stays for the rest", () => {
    // Both rows are retirement living expenses, so one scale lever moves both.
    const tree = buildClientData({
      expenses: [{ id: "exp-retire", type: "living", name: "Retirement", annualAmount: 100_000, startYear: 2035, endYear: 2055, growthRate: 0.03 }],
    });
    const add = heldAdd({ type: "living", name: "Travel", startYear: 2035, endYear: 2045 });
    const control: SolverMutation = { kind: "living-expense-scale", multiplier: 1.1 };
    const mutations = [add, control];
    const { held, controls } = foldControlsIntoHeldAdds(withHeld(tree, mutations), CLIENT, mutations);
    expect((held[0].payload as Expense).annualAmount).toBeCloseTo(5500);
    expect(controls).toEqual([control]);
  });

  it("with no held add, every control passes through without reading the tree", () => {
    const control: SolverMutation = { kind: "retirement-age", person: "client", age: 67 };
    const edit: HeldChangeMutation = {
      kind: "held-change",
      op: "edit",
      targetKind: "expense",
      targetId: E,
      payload: { annualAmount: { from: 1, to: 2 } },
      saveId: SAVE,
    };
    // A tree with no client would throw if the control's drafts were built.
    const { held, controls } = foldControlsIntoHeldAdds({} as ClientData, CLIENT, [edit, control]);
    expect(held.map((c) => c.opType)).toEqual(["edit"]);
    expect(controls).toEqual([control]);
  });
});
