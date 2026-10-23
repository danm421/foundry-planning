// Live-DB: the two scenario saves write held Details-editor changes through
// the scenario writer. Runs against the shared test household
// (TEST_FIRM_ID / TEST_CLIENT_ID) and deletes every scenario it creates.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { entities, scenarioChanges, scenarios } from "@/db/schema";
import type { Expense, LivingExpenseItem } from "@/engine/types";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { ScenarioChangeRejectedError } from "@/lib/scenario/changes-writer";
import { saveSolverScenario } from "../save-scenario";
import type { HeldChangeMutation, SolverMutation } from "../types";

const TEST_FIRM_ID = process.env.TEST_FIRM_ID;
const TEST_CLIENT_ID = process.env.TEST_CLIENT_ID;

// The PUT route's session gates; the writer's own firm check stays real.
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "user_test" }) }));
vi.mock("@/lib/db-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-helpers")>()),
  requireOrgId: vi.fn(async () => process.env.TEST_FIRM_ID),
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn(async () => ({ firmId: process.env.TEST_FIRM_ID, access: "own" })),
}));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { PUT } from "@/app/api/clients/[id]/solver/save-scenario/route";

const PREFIX = `t14-held-${randomUUID().slice(0, 8)}`;
const SAVE_ID = randomUUID();
const ITEMS: LivingExpenseItem[] = [
  { id: "i1", name: "Rent", amount: 2000, frequency: "monthly" },
  { id: "i2", name: "Travel", amount: 6000, frequency: "annual" },
];
const ITEMS_TOTAL = 30000;

const heldEdit = (targetId: string, payload: Record<string, { from: unknown; to: unknown }>): HeldChangeMutation => ({
  kind: "held-change",
  op: "edit",
  targetKind: "expense",
  targetId,
  payload,
  saveId: SAVE_ID,
});

const heldAdd = (payload: { id: string } & Record<string, unknown>): HeldChangeMutation => ({
  kind: "held-change",
  op: "add",
  targetKind: "expense",
  targetId: payload.id,
  payload,
  saveId: SAVE_ID,
});

const newExpense = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "other",
  name: "Held boat",
  annualAmount: "4200",
  startYear: 2030,
  endYear: 2040,
  growthSource: "custom",
  growthRate: "0.03",
  ...extra,
});

const amountControl = (expenseId: string, annualAmount: number): SolverMutation => ({
  kind: "expense-annual-amount",
  expenseId,
  annualAmount,
});

async function changesOf(scenarioId: string, targetId: string) {
  return db
    .select()
    .from(scenarioChanges)
    .where(and(eq(scenarioChanges.scenarioId, scenarioId), eq(scenarioChanges.targetId, targetId)));
}

describe.skipIf(!TEST_FIRM_ID || !TEST_CLIENT_ID)("scenario saves write held changes", () => {
  const clientId = TEST_CLIENT_ID!;
  const firmId = TEST_FIRM_ID!;
  /** A base expense with a plain total and a fixed end year. */
  let g: Expense;

  const post = (name: string, mutations: SolverMutation[]) =>
    saveSolverScenario({ clientId, firmId, source: "base", name: `${PREFIX} ${name}`, mutations });

  async function savedId(result: Awaited<ReturnType<typeof post>>): Promise<string> {
    if (!result.ok) throw new Error("save refused");
    return result.scenarioId;
  }

  beforeAll(async () => {
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});
    const found = effectiveTree.expenses.find(
      (e) =>
        e.endYear != null &&
        !e.livingItems?.length &&
        ![12100, 13000, ITEMS_TOTAL].includes(Number(e.annualAmount)),
    );
    if (!found) throw new Error("the test household needs a base expense with an end year");
    g = found;
  });

  afterEach(async () => {
    // scenario_changes and toggle groups go with the scenario (ON DELETE CASCADE).
    await db
      .delete(scenarios)
      .where(and(eq(scenarios.clientId, clientId), like(scenarios.name, `${PREFIX}%`)));
  });

  it("POST folds lever drafts into held targets", async () => {
    const scenarioId = await savedId(
      await post("fold", [
        heldEdit(g.id, {
          annualAmount: { from: g.annualAmount, to: 12100 },
          name: { from: g.name, to: "Groceries (held)" },
        }),
        amountControl(g.id, 13000),
      ]),
    );

    const rows = await changesOf(scenarioId, g.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].opType).toBe("edit");
    const payload = rows[0].payload as Record<string, { to: unknown }>;
    expect(payload.annualAmount.to).toBe(13000);
    expect(payload.name.to).toBe("Groceries (held)");
  });

  it("POST writes a held add", async () => {
    const id = randomUUID();
    const scenarioId = await savedId(await post("add", [heldAdd(newExpense(id))]));

    const rows = await changesOf(scenarioId, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ opType: "add", targetKind: "expense", toggleGroupId: null });
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenarioId, {});
    expect(effectiveTree.expenses.find((e) => e.id === id)?.annualAmount).toBe(4200);
  });

  // The Solver's screen shows a held expense as held: its items and their total.
  it("POST stores a held expense's items with their total", async () => {
    const scenarioId = await savedId(
      await post("items", [
        heldEdit(g.id, {
          livingItems: { from: null, to: ITEMS },
          annualAmount: { from: g.annualAmount, to: ITEMS_TOTAL },
        }),
      ]),
    );

    const [row] = await changesOf(scenarioId, g.id);
    const payload = row.payload as Record<string, { to: unknown }>;
    expect(payload.livingItems.to).toEqual(ITEMS);
    expect(Number(payload.annualAmount.to)).toBe(ITEMS_TOTAL);
  });

  // A control moved after the dialog wins, items or not: the screen shows the
  // control's total beside the held items, so the save stores that total.
  it("POST keeps a later control's total over held items", async () => {
    const scenarioId = await savedId(
      await post("items-control", [
        heldEdit(g.id, {
          livingItems: { from: null, to: ITEMS },
          annualAmount: { from: g.annualAmount, to: ITEMS_TOTAL },
        }),
        amountControl(g.id, 13000),
      ]),
    );

    const rows = await changesOf(scenarioId, g.id);
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, { to: unknown }>;
    expect(payload.livingItems.to).toEqual(ITEMS);
    expect(Number(payload.annualAmount.to)).toBe(13000);
  });

  it("POST writes nothing when the writer refuses a held entry", async () => {
    const bad = newExpense(randomUUID(), {
      livingItems: [{ id: "i1", name: "Rent", amount: -1, frequency: "monthly" }],
    });

    await expect(post("refused", [heldAdd(bad), amountControl(g.id, 13000)])).rejects.toBeInstanceOf(
      ScenarioChangeRejectedError,
    );
    const left = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.name, `${PREFIX} refused`)));
    expect(left).toEqual([]);
  });

  it("PUT writes held entries before controls and merges with an existing edit row", async () => {
    const [scn] = await db
      .insert(scenarios)
      .values({ clientId, name: `${PREFIX} put`, isBaseCase: false })
      .returning();
    await db.insert(scenarioChanges).values({
      scenarioId: scn.id,
      opType: "edit",
      targetKind: "expense",
      targetId: g.id,
      payload: { name: { from: g.name, to: "Groceries (scenario)" } },
      toggleGroupId: null,
      orderIndex: 0,
    });

    const res = await PUT(
      new Request(`http://localhost/api/clients/${clientId}/solver/save-scenario`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: scn.id,
          mutations: [
            heldEdit(g.id, {
              annualAmount: { from: g.annualAmount, to: 12100 },
              endYear: { from: g.endYear, to: g.endYear + 1 },
            }),
            amountControl(g.id, 13000),
          ],
        }),
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(200);
    const rows = await changesOf(scn.id, g.id);
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, { to: unknown }>;
    expect(payload.name.to).toBe("Groceries (scenario)");
    expect(payload.endYear.to).toBe(g.endYear + 1);
    // The control is written after the held entry, so its total stands.
    expect(payload.annualAmount.to).toBe(13000);
  });

  // The load applies a held trust removal, whose cascade strips the trust from
  // a will it reaches. The writer must save the will as held, not as the load
  // left it, or switching the removal off later can't bring the bequest back.
  describe("a held will beside a held trust removal", () => {
    let trustId: string;
    const willId = randomUUID();

    beforeAll(async () => {
      const [trust] = await db
        .insert(entities)
        .values({ clientId, name: `${PREFIX} trust`, entityType: "trust", isIrrevocable: true })
        .returning();
      trustId = trust.id;
    });

    afterAll(async () => {
      await db.delete(entities).where(and(eq(entities.clientId, clientId), like(entities.name, `${PREFIX}%`)));
    });

    const willAndRemoval = (): SolverMutation[] => [
      {
        kind: "held-change",
        op: "add",
        targetKind: "will",
        targetId: willId,
        payload: {
          id: willId,
          grantor: "client",
          bequests: [
            {
              id: "b1",
              name: "To the trust",
              kind: "asset",
              assetMode: "all_assets",
              accountId: null,
              entityId: null,
              liabilityId: null,
              percentage: 100,
              condition: "always",
              sortOrder: 0,
              recipients: [{ recipientKind: "entity", recipientId: trustId, percentage: 100, sortOrder: 0 }],
            },
          ],
          residuaryRecipients: [{ recipientKind: "entity", recipientId: trustId, percentage: 100, sortOrder: 0 }],
        },
        saveId: SAVE_ID,
      },
      { kind: "held-change", op: "remove", targetKind: "entity", targetId: trustId, payload: null, saveId: randomUUID() },
    ];

    function expectNamesTrust(payload: unknown) {
      const will = payload as {
        bequests: { recipients: { recipientId: string }[] }[];
        residuaryRecipients: { recipientId: string }[];
      };
      expect(will.bequests[0]?.recipients.map((r) => r.recipientId)).toEqual([trustId]);
      expect(will.residuaryRecipients.map((r) => r.recipientId)).toEqual([trustId]);
    }

    it("POST writes the will as held", async () => {
      const scenarioId = await savedId(await post("will", willAndRemoval()));
      const [willRow] = await changesOf(scenarioId, willId);
      expectNamesTrust(willRow.payload);
      expect((await changesOf(scenarioId, trustId)).map((r) => r.opType)).toEqual(["remove"]);
    });

    it("PUT writes the will as held", async () => {
      const [scn] = await db
        .insert(scenarios)
        .values({ clientId, name: `${PREFIX} put-will`, isBaseCase: false })
        .returning();
      const res = await PUT(
        new Request(`http://localhost/api/clients/${clientId}/solver/save-scenario`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scenarioId: scn.id, mutations: willAndRemoval() }),
        }) as never,
        { params: Promise.resolve({ id: clientId }) },
      );
      expect(res.status).toBe(200);
      const [willRow] = await changesOf(scn.id, willId);
      expectNamesTrust(willRow.payload);
    });
  });
});
