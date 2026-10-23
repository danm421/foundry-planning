import { describe, it, expect } from "vitest";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { Expense } from "@/engine/types";
import { applyMutations } from "../apply-mutations";
import { buildDissolveTrustMutations } from "../trust-levers";
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

  it("idsCreatedBy: entity-upsert / external-beneficiary-upsert on a plan with no such lists", () => {
    const tree = buildClientData();
    expect(tree.entities).toBeUndefined();
    expect(tree.externalBeneficiaries).toBeUndefined();
    const entity = { id: NEW_ID } as never;
    expect(idsCreatedBy({ kind: "entity-upsert", id: NEW_ID, value: entity }, tree)).toEqual([NEW_ID]);
    expect(idsCreatedBy({ kind: "external-beneficiary-upsert", id: NEW_ID, value: entity }, tree)).toEqual([NEW_ID]);
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

// The server applies held gift changes through the loader's gift overlay
// (applyGiftOverlays): a gift draft becomes the row and events the engine and
// the Solver's own gift sweeps read.
describe("held gifts in the held tree", () => {
  const TRUST = "00000000-0000-4000-8000-0000000000c4";
  const GIFT = "00000000-0000-4000-8000-0000000000d4";

  it("a held gift to a trust lands as the loader lands it, so a trust removal clears it", () => {
    const tree = {
      ...buildClientData(),
      entities: [{ id: TRUST, name: "Family trust", entityType: "trust", isIrrevocable: true }],
    } as never;
    const giftAdd: HeldChangeMutation = {
      kind: "held-change",
      op: "add",
      targetKind: "gift",
      targetId: GIFT,
      payload: {
        id: GIFT, kind: "cash-once", year: 2030, amount: 50_000, grantor: "client",
        recipient: { kind: "entity", id: TRUST }, crummey: false,
      },
      saveId: SAVE,
    };
    const out = applyHeldChanges(tree, [giftAdd]);
    expect(out.gifts).toContainEqual(expect.objectContaining({ id: GIFT, recipientEntityId: TRUST, amount: 50_000 }));
    expect(buildDissolveTrustMutations(out, { id: TRUST, name: "Family trust" } as never)).toContainEqual({
      kind: "gift-upsert",
      id: GIFT,
      value: null,
    });
  });
});

// A removal's cascades rewrite the will they reach (bequests, residuary). The
// held entry's payload must never be what they rewrite: the same entry is the
// browser draft, the next projection's input and what a save writes.
describe("held payloads survive a held trust or charity removal", () => {
  const TRUST = "00000000-0000-4000-8000-0000000000c1";
  const CHARITY = "00000000-0000-4000-8000-0000000000c2";
  const WILL = "00000000-0000-4000-8000-0000000000c3";
  const tree = () =>
    ({
      ...buildClientData(),
      entities: [{ id: TRUST, name: "Trust T" }],
      externalBeneficiaries: [{ id: CHARITY, name: "Charity" }],
      wills: [],
    }) as never;
  const removeOf = (targetKind: "entity" | "external_beneficiary", targetId: string): HeldChangeMutation => ({
    kind: "held-change",
    op: "remove",
    targetKind,
    targetId,
    payload: null,
    saveId: "00000000-0000-4000-8000-0000000000b2",
  });
  const bequests = () => [
    { id: "b1", name: "To trust", recipients: [{ recipientKind: "entity", recipientId: TRUST, percentage: 100 }] },
  ];

  it("a held will add keeps its bequests and residuary recipients", () => {
    const willAdd: HeldChangeMutation = {
      kind: "held-change",
      op: "add",
      targetKind: "will",
      targetId: WILL,
      payload: {
        id: WILL,
        grantor: "client",
        bequests: bequests(),
        residuaryRecipients: [{ recipientKind: "external_beneficiary", recipientId: CHARITY, percentage: 100 }],
      },
      saveId: SAVE,
    };
    const before = JSON.stringify(willAdd);
    applyHeldChanges(tree(), [willAdd, removeOf("entity", TRUST), removeOf("external_beneficiary", CHARITY)]);
    expect(JSON.stringify(willAdd)).toBe(before);
    // With both removals switched off, the will names the trust and the charity again.
    const off = applyHeldChanges(tree(), [willAdd]) as unknown as {
      wills: { bequests: { recipients: unknown[] }[]; residuaryRecipients: unknown[] }[];
    };
    expect(off.wills[0].bequests[0].recipients).toHaveLength(1);
    expect(off.wills[0].residuaryRecipients).toHaveLength(1);
  });

  it("a held will edit keeps its bequest's recipients", () => {
    const base = { ...(tree() as object), wills: [{ id: WILL, grantor: "client", bequests: [], residuaryRecipients: [] }] };
    const willEdit: HeldChangeMutation = {
      kind: "held-change",
      op: "edit",
      targetKind: "will",
      targetId: WILL,
      payload: { bequests: { from: [], to: bequests() } },
      saveId: SAVE,
    };
    const before = JSON.stringify(willEdit);
    applyHeldChanges(base as never, [willEdit, removeOf("entity", TRUST)]);
    expect(JSON.stringify(willEdit)).toBe(before);
    const off = applyHeldChanges(base as never, [willEdit]) as unknown as {
      wills: { bequests: { recipients: unknown[] }[] }[];
    };
    expect(off.wills[0].bequests[0].recipients).toHaveLength(1);
  });
});
