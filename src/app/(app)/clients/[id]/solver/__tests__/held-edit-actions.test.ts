// Unit tests for `prepareHeldEdits`: a Details editor's save inside the Solver
// runs the scenario `/changes` route's checks and preparation, then holds the
// edits as unsaved entries. Mocked at the lib boundary like
// change-editor-actions.test.ts; the scenario writer's checks
// (`normalizeExpenseLivingItems`, `assertGiftRecipientAccepted`) and the
// beneficiary defaults run for real against a mocked `db` whose writes are
// spies that must never fire.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { buildClientData, sampleExpenses, sampleFamilyMembers } from "@/engine/__tests__/fixtures";
import { STRESS_TEST_IDS } from "@/engine/stress-tests";
import type { ClientData, Expense, LivingExpenseItem } from "@/engine/types";
import type { HeldChangeMutation, SolverMutation } from "@/lib/solver/types";

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));
vi.mock("@/lib/clients/base-case", () => ({ baseCaseScenarioId: vi.fn() }));
vi.mock("@/lib/scenario/route-scope", () => ({ assertScenarioRouteScope: vi.fn() }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/scenario/changes-writer", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/scenario/changes-writer")>();
  return {
    ...actual,
    applyEntityAdd: vi.fn(),
    applyEntityEdit: vi.fn(),
    applyEntityRemove: vi.fn(),
    revertChange: vi.fn(),
    assertGiftRecipientAccepted: vi.fn(actual.assertGiftRecipientAccepted),
  };
});

import { prepareHeldEdits } from "../held-edit-actions";
import { db } from "@/db";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { baseCaseScenarioId } from "@/lib/clients/base-case";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  applyEntityAdd,
  applyEntityEdit,
  applyEntityRemove,
  assertGiftRecipientAccepted,
  revertChange,
} from "@/lib/scenario/changes-writer";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const SCENARIO_ID = "00000000-0000-4000-8000-000000000002";
const BASE_CASE_ID = "00000000-0000-4000-8000-000000000003";
const SAVE_ID = "00000000-0000-4000-8000-0000000000b1";
const EARLIER_SAVE = "00000000-0000-4000-8000-0000000000b0";
const OFF_SAVE = "00000000-0000-4000-8000-0000000000b2";
const FIRM_ID = "firm_owning";
const G = "00000000-0000-4000-8000-0000000000e1";
const LIVING = "00000000-0000-4000-8000-0000000000e2";
const BOAT = "00000000-0000-4000-8000-0000000000e3";
const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
const GIFT = "00000000-0000-4000-8000-0000000000f1";
const TRUST = "00000000-0000-4000-8000-0000000000f2";

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
const living: Expense = { ...groceries, id: LIVING, type: "living", name: "Current living", annualAmount: 60000 };
const boat: Expense = { ...groceries, id: BOAT, name: "Boat", annualAmount: 5000 };
const sourceTree = buildClientData({ expenses: [...sampleExpenses, groceries, living, boat] });

const items: LivingExpenseItem[] = [
  { id: "i1", name: "Rent", amount: 2000, frequency: "monthly" },
  { id: "i2", name: "Travel", amount: 6000, frequency: "annual" },
];

const writes = () => [
  db.insert,
  db.update,
  db.delete,
  db.execute,
  db.transaction,
  applyEntityAdd,
  applyEntityEdit,
  applyEntityRemove,
  revertChange,
];

/** The dialog itemizes the living row; the total it sends is `annualAmount`. */
const itemize = (annualAmount: string) => ({
  op: "edit" as const,
  targetKind: "expense" as const,
  targetId: LIVING,
  desiredFields: { livingItems: items, annualAmount },
});

function held(targetId: string, payload: unknown, saveId = EARLIER_SAVE): HeldChangeMutation {
  return { kind: "held-change", op: "edit", targetKind: "expense", targetId, payload, saveId };
}

/** Every load returns `sourceTree`, or `withHeld` once held changes are passed. */
function treesAre(withHeld: ClientData = sourceTree) {
  vi.mocked(loadEffectiveTree).mockImplementation(async (_c, _f, _s, _t, extra = []) => ({
    effectiveTree: extra.length > 0 ? withHeld : sourceTree,
    warnings: [],
  }));
}

/** `db.select().from().where()` answers each call with the next of `results`. */
function selectsReturn(...results: unknown[][]) {
  vi.mocked(db.select).mockImplementation((() => ({
    from: () => ({ where: async () => results.shift() ?? [] }),
  })) as never);
}

function prepare(over: Partial<Parameters<typeof prepareHeldEdits>[0]> = {}) {
  return prepareHeldEdits({
    clientId: CLIENT_ID,
    source: SCENARIO_ID,
    mutations: [],
    offGroups: [],
    edits: [],
    saveId: SAVE_ID,
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireClientEditAccess).mockResolvedValue({
    client: { id: CLIENT_ID },
    firmId: FIRM_ID,
    access: "own",
  } as never);
  vi.mocked(assertScenarioRouteScope).mockResolvedValue({
    kind: "ok",
    scenario: { id: SCENARIO_ID, clientId: CLIENT_ID, isBaseCase: false },
  } as never);
  vi.mocked(baseCaseScenarioId).mockResolvedValue(BASE_CASE_ID);
  treesAre();
  selectsReturn();
});

describe("prepareHeldEdits — holding", () => {
  it("holds an expense edit without any write", async () => {
    const control: SolverMutation = { kind: "expense-annual-amount", expenseId: G, annualAmount: 12500 };

    const result = await prepare({
      mutations: [control],
      edits: [{ op: "edit", targetKind: "expense", targetId: G, desiredFields: { annualAmount: 13000 } }],
    });

    expect(result).toEqual({
      ok: true,
      upserts: [
        {
          kind: "held-change",
          op: "edit",
          targetKind: "expense",
          targetId: G,
          payload: { annualAmount: { from: 12000, to: 13000 } },
          saveId: SAVE_ID,
        },
      ],
      // The stepper on the same field is folded into the held edit.
      dropKeys: [`expense-annual-amount:${G}`],
      reply: { ok: true },
    });
    expect(assertScenarioRouteScope).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID, FIRM_ID);
    expect(loadEffectiveTree).toHaveBeenCalledWith(CLIENT_ID, FIRM_ID, SCENARIO_ID, {});
    for (const write of writes()) expect(write).not.toHaveBeenCalled();
  });

  it("normalizes living items (the total equals the sum of the items)", async () => {
    const result = await prepare({
      edits: [itemize("1")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2,000 a month + 6,000 a year.
    expect(result.upserts[0].payload).toEqual({
      livingItems: { from: undefined, to: items },
      annualAmount: { from: 60000, to: "30000" },
    });
    for (const write of writes()) expect(write).not.toHaveBeenCalled();
  });

  it("takes the current living items from the tree with the switched-on held changes", async () => {
    // An earlier held save itemized the row; another screen then typed 45,000.
    const onEntry = held(LIVING, { livingItems: { from: null, to: items } });
    const offEntry = held(BOAT, { annualAmount: { from: 5000, to: 9000 } }, OFF_SAVE);
    const withHeld = buildClientData({
      expenses: [...sampleExpenses, groceries, { ...living, livingItems: items, annualAmount: 45000 }, boat],
    });
    treesAre(withHeld);

    const result = await prepare({
      mutations: [onEntry, offEntry],
      offGroups: [`save:${offEntry.saveId}`],
      edits: [itemize("45000")],
    });

    // Same items as the row already has, so the typed total stands.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.upserts[0].payload).toMatchObject({ annualAmount: { to: "45000" } });
    // Only the switched-on held entry reaches the tree.
    const extras = vi.mocked(loadEffectiveTree).mock.calls.map((c) => c[4] ?? []).filter((e) => e.length > 0);
    expect(extras).toHaveLength(1);
    expect(extras[0].map((c) => c.targetId)).toEqual([LIVING]);
  });

  it("adds default beneficiaries to a new retirement account and replies with them", async () => {
    const [client] = sampleFamilyMembers;
    const entity = {
      id: ACCOUNT,
      name: "New IRA",
      category: "retirement",
      subType: "traditional_ira",
      value: 0,
      basis: 0,
      growthRate: 0.05,
      owners: [{ kind: "family_member", familyMemberId: client.id, percent: 1 }],
    };

    const result = await prepare({ source: "base", edits: [{ op: "add", targetKind: "account", entity }] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const beneficiaries = [
      {
        id: expect.any(String),
        tier: "primary",
        percentage: 100,
        householdRole: "spouse",
        familyMemberId: undefined,
        sortOrder: 0,
      },
    ];
    expect(result.reply).toEqual({ ok: true, targetId: ACCOUNT, beneficiaries });
    expect(result.upserts).toEqual([
      expect.objectContaining({
        op: "add",
        targetKind: "account",
        targetId: ACCOUNT,
        payload: { ...entity, beneficiaries },
      }),
    ]);
    // "base" reads the household as the base case's scenario sees it.
    expect(assertScenarioRouteScope).not.toHaveBeenCalled();
    expect(baseCaseScenarioId).toHaveBeenCalledWith(CLIENT_ID, FIRM_ID);
    expect(loadEffectiveTree).toHaveBeenCalledWith(CLIENT_ID, FIRM_ID, BASE_CASE_ID, {});
    for (const write of writes()) expect(write).not.toHaveBeenCalled();
  });

  it("holds the parsed copy of a whole-entity add", async () => {
    const stress = { id: STRESS_TEST_IDS.inflation, name: "High inflation", kind: "inflation", rate: 0.06 };

    const result = await prepare({
      edits: [{ op: "add", targetKind: "stress_test", entity: { ...stress, stray: "dropped" } }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.upserts[0].payload).toEqual(stress);
  });
});

describe("prepareHeldEdits — refusals", () => {
  it("refuses a gift to a revocable trust with status 400", async () => {
    // No scenario add of the trust, then the base row: revocable.
    selectsReturn([], [{ entityType: "trust", isIrrevocable: false }]);
    const gift = {
      id: GIFT,
      kind: "cash-once",
      year: 2030,
      amount: 50_000,
      grantor: "client",
      recipient: { kind: "entity", id: TRUST },
      crummey: false,
    };

    const result = await prepare({ edits: [{ op: "add", targetKind: "gift", entity: gift }] });

    expect(result).toEqual({ ok: false, status: 400, error: "Gifts to revocable trusts are not completed gifts" });
    expect(assertGiftRecipientAccepted).toHaveBeenCalledWith(db, SCENARIO_ID, CLIENT_ID, gift);
    for (const write of writes()) expect(write).not.toHaveBeenCalled();
  });

  it("refuses a whole-entity edit", async () => {
    const result = await prepare({
      edits: [
        { op: "edit", targetKind: "stress_test", targetId: STRESS_TEST_IDS.inflation, desiredFields: { rate: 0.07 } },
      ],
    });

    expect(result).toEqual({ ok: false, status: 400, error: 'stress_test changes are saved whole with op "add"' });
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("refuses an invalid whole-entity add", async () => {
    const result = await prepare({
      edits: [{ op: "add", targetKind: "stress_test", entity: { id: STRESS_TEST_IDS.inflation, kind: "inflation" } }],
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: expect.any(String) });
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("refuses a nested-only target kind with 400, before anything loads", async () => {
    const result = await prepare({
      edits: [{ op: "edit", targetKind: "transfer_schedule", targetId: G, desiredFields: { amount: 1 } }],
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: expect.any(String) });
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("refuses an add whose held entry would not pass the Solver's schema", async () => {
    // The change schema takes any non-empty id; a held entry needs a uuid.
    const result = await prepare({
      edits: [{ op: "add", targetKind: "expense", entity: { ...boat, id: "boat-2" } }],
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: expect.any(String) });
  });

  it("refuses without edit access", async () => {
    vi.mocked(requireClientEditAccess).mockRejectedValue(new Error("Edit access required"));

    await expect(
      prepare({ edits: [{ op: "edit", targetKind: "expense", targetId: G, desiredFields: { annualAmount: 1 } }] }),
    ).rejects.toThrow("Edit access required");
    expect(requireClientEditAccess).toHaveBeenCalledWith(CLIENT_ID);
    expect(assertScenarioRouteScope).not.toHaveBeenCalled();
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("refuses a scenario that isn't this client's", async () => {
    vi.mocked(assertScenarioRouteScope).mockResolvedValue({
      kind: "miss",
      response: NextResponse.json({ error: "Scenario not found" }, { status: 404 }),
    } as never);

    await expect(
      prepare({ edits: [{ op: "edit", targetKind: "expense", targetId: G, desiredFields: { annualAmount: 1 } }] }),
    ).rejects.toThrow();
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("rejects a malformed edit before any query", async () => {
    for (const edits of [
      [{ op: "edit", targetKind: "expense", targetId: "not-a-uuid", desiredFields: {} }],
      [{ op: "add", targetKind: "nonsense", entity: { id: G } }],
      [],
    ]) {
      const result = await prepare({ edits: edits as never });
      expect(result).toMatchObject({ ok: false, status: 400, error: expect.any(String) });
    }
    expect(requireClientEditAccess).not.toHaveBeenCalled();
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });
});
