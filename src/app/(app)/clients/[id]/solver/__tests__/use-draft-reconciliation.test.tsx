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

const SS_ITEM: InventoryItem = {
  key: "social_security:ss1",
  typeKey: "social_security",
  id: "ss1",
  label: "Social Security",
  canEdit: true,
  canDelete: false,
  draftRef: { person: "client" },
};
const WITHDRAWAL_ITEM: InventoryItem = {
  key: "savings_withdrawals:withdrawal",
  typeKey: "savings_withdrawals",
  id: "withdrawal",
  label: "Savings & withdrawals",
  canEdit: true,
  canDelete: false,
};

const incomeDraft: SolverMutation = { kind: "income-annual-amount", incomeId: "i1", annualAmount: 90000 };
const ruleDraft: SolverMutation = { kind: "savings-contribution", accountId: "a1", annualAmount: 5000 };
const otherDraft: SolverMutation = { kind: "income-annual-amount", incomeId: "i2", annualAmount: 1 };

function setup(mutations: SolverMutation[]) {
  const clearMutations = vi.fn();
  const hook = renderHook(() =>
    useDraftReconciliation({
      inventory: [INCOME_ITEM, RULE_ITEM, SS_ITEM, WITHDRAWAL_ITEM],
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

  // A create has no inventory item: the draft row the advisor was adding is
  // superseded by id alone. Ignoring create events would leave this behind.
  it("an event with no inventory item (a create) targets by kind and id alone", () => {
    const draftAdd: SolverMutation = {
      kind: "income-upsert",
      id: "i9",
      value: { id: "i9", name: "Draft income" },
    } as unknown as SolverMutation;
    const { result, clearMutations } = setup([draftAdd, incomeDraft]);
    act(() => {
      result.current.onTargetsWritten([{ targetKind: "income", targetId: "i9", op: "add" }], "Income");
    });
    expect(clearMutations).toHaveBeenCalledWith([mutationKey(draftAdd)]);
    expect(result.current.notice).toContain("Income");
  });

  it("a Social Security write drops that person's ss-* levers only", () => {
    const clientSs: SolverMutation = { kind: "ss-claim-age", person: "client", claimAge: 70 } as unknown as SolverMutation;
    const spouseSs: SolverMutation = { kind: "ss-claim-age", person: "spouse", claimAge: 67 } as unknown as SolverMutation;
    const { result, clearMutations } = setup([clientSs, spouseSs]);
    act(() => {
      result.current.onTargetsWritten([{ targetKind: "income", targetId: "ss1", op: "edit" }], "Social Security");
    });
    expect(clearMutations).toHaveBeenCalledWith([mutationKey(clientSs)]);
  });

  it("a plan_settings write addressed to the withdrawal tab drops the surplus-allocation lever", () => {
    const surplus: SolverMutation = {
      kind: "surplus-allocation",
      spendPct: 0.5,
      saveAccountId: null,
      spendAllUntilRetirement: false,
    };
    const { result, clearMutations } = setup([surplus]);
    act(() => {
      result.current.onTargetsWritten([{ targetKind: "plan_settings", targetId: "withdrawal", op: "edit" }], "Savings & withdrawals");
    });
    expect(clearMutations).toHaveBeenCalledWith(["surplus-allocation"]);
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
