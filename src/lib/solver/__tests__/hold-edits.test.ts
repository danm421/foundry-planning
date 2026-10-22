import { describe, it, expect } from "vitest";
import {
  buildClientData,
  sampleAccounts,
  sampleExpenses,
  sampleSavingsRules,
} from "@/engine/__tests__/fixtures";
import type { Account, Expense } from "@/engine/types";
import type { OpType, TargetKind } from "@/engine/scenario/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { holdEdits, type PreparedEdit } from "../held-changes";
import {
  mutationKey,
  type HeldChangeMutation,
  type SolverMutation,
  type SolverMutationKey,
} from "../types";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const SAVE = "00000000-0000-4000-8000-0000000000b1";
const EARLIER_SAVE = "00000000-0000-4000-8000-0000000000b0";
const G = "00000000-0000-4000-8000-0000000000e1";
const BOAT = "00000000-0000-4000-8000-0000000000e2";
const A = "00000000-0000-4000-8000-0000000000a1";
const RULE = "00000000-0000-4000-8000-0000000000d1";
const GIFT = "00000000-0000-4000-8000-0000000000f1";

/** G: a base expense, annualAmount 12,000. */
const groceries: Expense = {
  id: G,
  type: "other",
  name: "Groceries",
  annualAmount: 12000,
  startYear: 2026,
  endYear: 2055,
  growthRate: 0.02,
};
const source = buildClientData({
  expenses: [...sampleExpenses, groceries],
  gifts: [{ id: GIFT, year: 2030, amount: 50_000, grantor: "client", useCrummeyPowers: false }],
});

const boat: Expense = {
  id: BOAT,
  type: "other",
  name: "Boat",
  annualAmount: 5000,
  startYear: 2030,
  endYear: 2040,
  growthRate: 0,
};
const newAccount: Account = { ...sampleAccounts[2], id: A, name: "New brokerage" };

/** A base gift, as the gift dialog and the Solver's gift control carry it. */
const gift: EstateFlowGift = {
  kind: "cash-once",
  id: GIFT,
  year: 2030,
  amount: 50_000,
  grantor: "client",
  recipient: { kind: "external_beneficiary", id: "c1" },
  crummey: false,
};

function held(
  op: OpType,
  targetKind: TargetKind,
  targetId: string,
  payload: unknown,
  saveId = EARLIER_SAVE,
): HeldChangeMutation {
  return { kind: "held-change", op, targetKind, targetId, payload, saveId };
}

const editG = (desiredFields: Record<string, unknown>): PreparedEdit => ({
  op: "edit",
  targetKind: "expense",
  targetId: G,
  desiredFields,
});

const groceriesControl = (annualAmount: number): SolverMutation => ({
  kind: "expense-annual-amount",
  expenseId: G,
  annualAmount,
});

function hold(all: SolverMutation[], edits: PreparedEdit[], offKeys: SolverMutationKey[] = []) {
  return holdEdits({ all, offKeys: new Set(offKeys), edits, source, clientId: CLIENT, saveId: SAVE });
}

describe("holdEdits", () => {
  it("edit keeps only fields that differ from the starting plan", () => {
    const r = hold([], [editG({ annualAmount: 12100, name: "Groceries" })]);
    expect(r.upserts).toEqual([
      held("edit", "expense", G, { annualAmount: { from: 12000, to: 12100 } }, SAVE),
    ]);
    expect(r.dropKeys).toEqual([]);
  });

  it("an edit back to the starting values drops the entry", () => {
    const prior = held("edit", "expense", G, { annualAmount: { from: 12000, to: 12100 } });
    const r = hold([prior], [editG({ annualAmount: 12000, name: "Groceries" })]);
    expect(r.upserts).toEqual([]);
    expect(r.dropKeys).toEqual([mutationKey(prior)]);
  });

  it("second save merges into the same row", () => {
    const prior = held("edit", "expense", G, { annualAmount: { from: 12000, to: 12100 } });
    const r = hold([prior], [editG({ growthRate: 0.03 })]);
    expect(r.upserts).toEqual([
      held(
        "edit",
        "expense",
        G,
        { annualAmount: { from: 12000, to: 12100 }, growthRate: { from: 0.02, to: 0.03 } },
        SAVE,
      ),
    ]);
    expect(r.dropKeys).toEqual([]);
  });

  it("saving over a switched-off entry replaces it", () => {
    const prior = held("edit", "expense", G, { endYear: { from: 2055, to: 2040 } });
    const r = hold([prior], [editG({ annualAmount: 12100 })], [mutationKey(prior)]);
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0].payload).toEqual({ annualAmount: { from: 12000, to: 12100 } });
    expect(r.dropKeys).toEqual([]);
  });

  it("folds an earlier control into the held edit", () => {
    const control = groceriesControl(13000);
    const r = hold([control], [editG({ annualAmount: 13000, growthRate: 0.03 })]);
    expect(r.upserts).toEqual([
      held(
        "edit",
        "expense",
        G,
        { annualAmount: { from: 12000, to: 13000 }, growthRate: { from: 0.02, to: 0.03 } },
        SAVE,
      ),
    ]);
    expect(r.dropKeys).toContain(`expense-annual-amount:${G}`);
  });

  it("a control on another field survives", () => {
    const r = hold([groceriesControl(13000)], [editG({ growthRate: 0.03 })]);
    expect(r.dropKeys).toEqual([]);
    expect(r.upserts[0].payload).toEqual({ growthRate: { from: 0.02, to: 0.03 } });
  });

  it("a switched-off control is never dropped", () => {
    const control = groceriesControl(13000);
    const r = hold([control], [editG({ annualAmount: 12500 })], [mutationKey(control)]);
    expect(r.dropKeys).toEqual([]);
  });

  it("edit of a held add folds into the add", () => {
    const add = held("add", "expense", BOAT, boat);
    const r = hold([add], [{ op: "edit", targetKind: "expense", targetId: BOAT, desiredFields: { annualAmount: 6000 } }]);
    expect(r.upserts).toEqual([held("add", "expense", BOAT, { ...boat, annualAmount: 6000 }, SAVE)]);
    expect(r.dropKeys).toEqual([]);
  });

  it("edit of a held add folds an earlier control on it into the add", () => {
    const add = held("add", "expense", BOAT, boat);
    const control: SolverMutation = { kind: "expense-annual-amount", expenseId: BOAT, annualAmount: 7000 };
    const r = hold(
      [add, control],
      [{ op: "edit", targetKind: "expense", targetId: BOAT, desiredFields: { annualAmount: 6000 } }],
    );
    expect(r.upserts).toEqual([held("add", "expense", BOAT, { ...boat, annualAmount: 6000 }, SAVE)]);
    expect(r.dropKeys).toEqual([mutationKey(control)]);
  });

  it("edit of a control-created account becomes a held add and drops the control", () => {
    const control: SolverMutation = { kind: "account-upsert", id: A, value: newAccount };
    const r = hold([control], [{ op: "edit", targetKind: "account", targetId: A, desiredFields: { value: 400000 } }]);
    expect(r.upserts).toEqual([held("add", "account", A, { ...newAccount, value: 400000 }, SAVE)]);
    expect(r.dropKeys).toEqual([`account-upsert:${A}`]);
  });

  it("remove of a held add drops it and every entry naming it", () => {
    const add = held("add", "account", A, newAccount);
    const rule: SolverMutation = {
      kind: "savings-rule-upsert",
      id: RULE,
      value: { ...sampleSavingsRules[0], id: RULE, accountId: A },
    };
    const other = groceriesControl(13000);
    const r = hold([add, rule, other], [{ op: "remove", targetKind: "account", targetId: A }]);
    expect(r.upserts).toEqual([]);
    expect([...r.dropKeys].sort()).toEqual([mutationKey(add), mutationKey(rule)].sort());
  });

  it("remove of a control-created account drops the control and every entry naming it", () => {
    const control: SolverMutation = { kind: "account-upsert", id: A, value: newAccount };
    const rule: SolverMutation = {
      kind: "savings-rule-upsert",
      id: RULE,
      value: { ...sampleSavingsRules[0], id: RULE, accountId: A },
    };
    const r = hold([control, rule], [{ op: "remove", targetKind: "account", targetId: A }]);
    expect(r.upserts).toEqual([]);
    expect([...r.dropKeys].sort()).toEqual([mutationKey(control), mutationKey(rule)].sort());
  });

  it("remove of a base item drops controls on it", () => {
    const control = groceriesControl(13000);
    const priorEdit = held("edit", "expense", G, { growthRate: { from: 0.02, to: 0.03 } });
    const otherItem: SolverMutation = { kind: "income-annual-amount", incomeId: "inc-salary-john", annualAmount: 160000 };
    const r = hold([control, priorEdit, otherItem], [{ op: "remove", targetKind: "expense", targetId: G }]);
    expect(r.upserts).toEqual([held("remove", "expense", G, null, SAVE)]);
    expect(r.dropKeys).toEqual([mutationKey(control)]);
  });

  it("a control parked at the starting value is folded into a dialog change", () => {
    const control = groceriesControl(12000);
    const r = hold([control], [editG({ annualAmount: 13000 })]);
    expect(r.upserts).toEqual([
      held("edit", "expense", G, { annualAmount: { from: 12000, to: 13000 } }, SAVE),
    ]);
    expect(r.dropKeys).toEqual([mutationKey(control)]);
  });

  it("a base gift saved from its dialog (an add) drops the gift control on it", () => {
    const control: SolverMutation = { kind: "gift-upsert", id: GIFT, value: { ...gift, amount: 75_000 } };
    const elsewhere = groceriesControl(13000);
    const r = hold(
      [control, elsewhere],
      [{ op: "add", targetKind: "gift", targetId: GIFT, entity: { ...gift, amount: 60_000 } }],
    );
    expect(r.upserts).toEqual([held("add", "gift", GIFT, { ...gift, amount: 60_000 }, SAVE)]);
    expect(r.dropKeys).toEqual([mutationKey(control)]);
  });

  it("gift remove is a remove marker", () => {
    // A held add on a gift id is a base gift's edit as often as a new gift.
    const add = held("add", "gift", GIFT, gift);
    const control: SolverMutation = { kind: "gift-upsert", id: GIFT, value: { ...gift, amount: 75_000 } };
    const r = hold([add, control], [{ op: "remove", targetKind: "gift", targetId: GIFT }]);
    expect(r.upserts).toEqual([held("remove", "gift", GIFT, null, SAVE)]);
    expect(r.dropKeys).toEqual([mutationKey(control)]);
  });

  it("edits in one save see each other", () => {
    const r = hold(
      [],
      [
        { op: "add", targetKind: "expense", targetId: BOAT, entity: { ...boat } },
        { op: "edit", targetKind: "expense", targetId: BOAT, desiredFields: { annualAmount: 6000 } },
      ],
    );
    expect(r.upserts).toEqual([held("add", "expense", BOAT, { ...boat, annualAmount: 6000 }, SAVE)]);
    expect(r.dropKeys).toEqual([]);
  });

  it("every upsert carries the saveId", () => {
    const r = hold(
      [held("edit", "expense", G, { endYear: { from: 2055, to: 2040 } })],
      [
        { op: "add", targetKind: "expense", targetId: BOAT, entity: { ...boat } },
        editG({ annualAmount: 12100 }),
        { op: "remove", targetKind: "liability", targetId: "liab-mortgage" },
      ],
    );
    expect(r.upserts.map((m) => [m.op, m.targetId])).toEqual([
      ["add", BOAT],
      ["edit", G],
      ["remove", "liab-mortgage"],
    ]);
    expect(r.upserts.every((m) => m.saveId === SAVE)).toBe(true);
  });
});
