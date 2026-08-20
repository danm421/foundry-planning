/**
 * The solver's "spend whatever's left" lever, end to end through the four pure
 * layers it crosses: apply → wire schema → save-to-base → save-as-scenario.
 *
 * It is a lever of its OWN (not folded into `expense-annual-amount`) so that
 * toggling the mode and moving the floor compose instead of clobbering each
 * other — the round-trip case below is the one that proves it.
 */
import { describe, it, expect } from "vitest";
import type { ClientData, Expense } from "@/engine/types";
import { applyMutations } from "../apply-mutations";
import { mutationsToBaseUpdates } from "../mutations-to-base-updates";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";
import { mutationKey, type SolverMutation } from "../types";

const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function living(id: string, over: Partial<Expense> = {}): Expense {
  return {
    id,
    type: "living",
    name: "Current Living Expenses",
    annualAmount: 90_000,
    startYear: 2026,
    endYear: 2060,
    growthRate: 0.024,
    ...over,
  } as Expense;
}

const source = {
  expenses: [living(CURRENT_ID), living(OTHER_ID, { name: "Groceries" })],
  incomes: [],
  savingsRules: [],
  accounts: [],
  withdrawalStrategy: [],
  planSettings: { planStartYear: 2026 },
  client: {},
} as unknown as ClientData;

const turnOn: SolverMutation = {
  kind: "expense-absorbs-remaining",
  expenseId: CURRENT_ID,
  value: true,
};

describe("expense-absorbs-remaining", () => {
  it("flags only the addressed row in the working tree", () => {
    const out = applyMutations(source, [turnOn]);
    expect(out.expenses[0].absorbsRemainingCashFlow).toBe(true);
    expect(out.expenses[1].absorbsRemainingCashFlow).toBeUndefined();
  });

  it("clears the flag when switched off", () => {
    const on = applyMutations(source, [turnOn]);
    const off = applyMutations(on, [{ ...turnOn, value: false }]);
    expect(off.expenses[0].absorbsRemainingCashFlow).toBe(false);
  });

  it("keys per expense, so the mode and the floor are separate levers", () => {
    // Same row, two levers: last-write-per-KEY must not let one drop the other.
    const floor: SolverMutation = {
      kind: "expense-annual-amount",
      expenseId: CURRENT_ID,
      annualAmount: 60_000,
    };
    expect(mutationKey(turnOn)).not.toBe(mutationKey(floor));
    const out = applyMutations(source, [turnOn, floor]);
    expect(out.expenses[0].absorbsRemainingCashFlow).toBe(true);
    expect(out.expenses[0].annualAmount).toBe(60_000);
  });

  it("survives the wire schema", () => {
    expect(SOLVER_MUTATION_SCHEMA.parse(turnOn)).toEqual(turnOn);
  });

  it("saves to base as a column patch on that expense", () => {
    const out = mutationsToBaseUpdates(source, [turnOn]);
    expect(out.expenseUpdates).toEqual([
      { id: CURRENT_ID, set: { absorbsRemainingCashFlow: true } },
    ]);
  });

  it("does not patch base for an expense the source doesn't have", () => {
    // Guards the same silent-no-op UPDATE the amount lever guards against.
    const out = mutationsToBaseUpdates(source, [
      { ...turnOn, expenseId: "33333333-3333-4333-8333-333333333333" },
    ]);
    expect(out.expenseUpdates).toEqual([]);
  });

  it("saves as a scenario change carrying from → to", () => {
    const [draft] = mutationsToScenarioChanges(source, "client-1", [turnOn]);
    expect(draft.targetKind).toBe("expense");
    expect(draft.targetId).toBe(CURRENT_ID);
    expect(draft.payload).toMatchObject({
      absorbsRemainingCashFlow: { from: false, to: true },
    });
  });

  it("emits no scenario change when the row already absorbs", () => {
    const already = {
      ...source,
      expenses: [living(CURRENT_ID, { absorbsRemainingCashFlow: true })],
    } as unknown as ClientData;
    expect(mutationsToScenarioChanges(already, "client-1", [turnOn])).toEqual([]);
  });
});
