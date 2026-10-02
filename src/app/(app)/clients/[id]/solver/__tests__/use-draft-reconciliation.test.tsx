// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraftReconciliation } from "../use-draft-reconciliation";
import { mutationKey, type SolverMutation } from "@/lib/solver/types";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";

const INCOME_ITEM: InventoryItem = {
  key: "income:i1",
  typeKey: "income",
  id: "i1",
  label: "Salary",
  canEdit: true,
  canDelete: true,
};
const RULE_ITEM: InventoryItem = {
  key: "savings_rule:r1",
  typeKey: "savings_rule",
  id: "r1",
  label: "401(k)",
  canEdit: true,
  canDelete: true,
  draftRef: { accountId: "a1" },
};

const incomeDraft: SolverMutation = { kind: "income-annual-amount", incomeId: "i1", annualAmount: 90000 };
const ruleDraft: SolverMutation = { kind: "savings-contribution", accountId: "a1", annualAmount: 5000 };
const otherDraft: SolverMutation = { kind: "income-annual-amount", incomeId: "i2", annualAmount: 1 };

function setup(mutations: SolverMutation[]) {
  const clearMutations = vi.fn();
  const hook = renderHook(() =>
    useDraftReconciliation({
      inventory: [INCOME_ITEM, RULE_ITEM],
      mutations,
      clearMutations,
    }),
  );
  return { ...hook, clearMutations };
}

describe("useDraftReconciliation", () => {
  it("a write for income:i1 removes income-annual-amount(i1) from the draft and sets the notice", () => {
    const { result, clearMutations } = setup([incomeDraft, otherDraft]);
    act(() => {
      result.current.onTargetsWritten([{ targetKind: "income", targetId: "i1", op: "edit" }], "Salary");
    });
    expect(clearMutations).toHaveBeenCalledWith([mutationKey(incomeDraft)]);
    expect(result.current.notice).toBe("Your unsaved Solver changes to Salary were replaced by this edit.");
  });

  it("an event for an id with no draft mutations shows no notice and clears nothing", () => {
    const { result, clearMutations } = setup([otherDraft]);
    act(() => {
      result.current.onTargetsWritten([{ targetKind: "income", targetId: "i1", op: "edit" }], "Salary");
    });
    expect(clearMutations).not.toHaveBeenCalled();
    expect(result.current.notice).toBeNull();
  });

  it("uses the inventory item's draftRef (a savings rule's levers are keyed on its account)", () => {
    const { result, clearMutations } = setup([ruleDraft]);
    act(() => {
      result.current.onTargetsWritten([{ targetKind: "savings_rule", targetId: "r1", op: "edit" }], "401(k)");
    });
    expect(clearMutations).toHaveBeenCalledWith([mutationKey(ruleDraft)]);
  });

  it("an event with no inventory item (a create) targets by kind and id alone", () => {
    const { result, clearMutations } = setup([incomeDraft]);
    act(() => {
      result.current.onTargetsWritten([{ targetKind: "income", targetId: "i9", op: "add" }], "Income");
    });
    expect(clearMutations).not.toHaveBeenCalled();
    act(() => {
      result.current.onTargetsWritten([{ targetKind: "income", targetId: "i1", op: "edit" }], "Salary");
    });
    expect(clearMutations).toHaveBeenCalledTimes(1);
  });

  it("collects every event's removals into one clear", () => {
    const { result, clearMutations } = setup([incomeDraft, ruleDraft]);
    act(() => {
      result.current.onTargetsWritten(
        [
          { targetKind: "income", targetId: "i1", op: "edit" },
          { targetKind: "savings_rule", targetId: "r1", op: "edit" },
        ],
        "Salary",
      );
    });
    expect(clearMutations).toHaveBeenCalledTimes(1);
    expect(new Set(clearMutations.mock.calls[0][0])).toEqual(
      new Set([mutationKey(incomeDraft), mutationKey(ruleDraft)]),
    );
  });

  it("the notice can be dismissed", () => {
    const { result } = setup([incomeDraft]);
    act(() => {
      result.current.onTargetsWritten([{ targetKind: "income", targetId: "i1", op: "edit" }], "Salary");
    });
    act(() => result.current.dismissNotice());
    expect(result.current.notice).toBeNull();
  });
});
