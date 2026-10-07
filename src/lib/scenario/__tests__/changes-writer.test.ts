// src/lib/scenario/__tests__/changes-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientDeductions, clients, expenses, planSettings, scenarios, scenarioChanges, scenarioToggleGroups } from "@/db/schema";
import {
  applyEntityEdit,
  applyEntityAdd,
  applyEntityRemove,
  normalizeExpenseLivingItems,
  priorToValues,
  ScenarioChangeRejectedError,
  revertChange,
  type ApplyEntityEditArgs,
} from "../changes-writer";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const COOPER_SALARY_INCOME_ID = "d99f3ccb-8eb5-44f9-ae81-f52fb2694458";
const COOPER_SALARY_BASE_AMOUNT = 250000;

// Pure — no DB, so it lives outside the live-DB block below and runs anywhere.
describe("priorToValues", () => {
  it("skips a stored entry that has no `to` key, keeping null and 0", () => {
    // JSON drops an `undefined` `to`, leaving `{from: X}` — that entry is not a
    // prior value and must not merge back in as `undefined`.
    expect(priorToValues({
      lost: { from: 1 },
      cleared: { from: 1, to: null },
      zeroed: { from: 1, to: 0 },
    })).toStrictEqual({ cleared: null, zeroed: 0 });
  });
});

// Pure — no DB.
describe("normalizeExpenseLivingItems", () => {
  const HOUSING = { id: "i1", name: "Housing", amount: 3200, frequency: "monthly" };

  it("leaves other kinds, and expense writes without items, untouched", () => {
    const f = { annualAmount: "1", livingItems: [HOUSING] };
    expect(normalizeExpenseLivingItems("income", f)).toBe(f);
    const g = { annualAmount: "90000" };
    expect(normalizeExpenseLivingItems("expense", g)).toBe(g);
  });

  it("sets the total from the items", () => {
    expect(
      normalizeExpenseLivingItems("expense", { livingItems: [HOUSING], annualAmount: "1", name: "x" }),
    ).toEqual({ livingItems: [HOUSING], annualAmount: "38400", name: "x" });
  });

  it("stores an emptied list as null", () => {
    expect(normalizeExpenseLivingItems("expense", { livingItems: [], annualAmount: "0" })).toEqual({
      livingItems: null,
      annualAmount: "0",
    });
  });

  it("rejects a malformed list as a 400-class refusal", () => {
    expect(() =>
      normalizeExpenseLivingItems("expense", { livingItems: [{ ...HOUSING, amount: -5 }] }),
    ).toThrow(ScenarioChangeRejectedError);
  });
});

// Skip when DB is unreachable. The test depends on Cooper Sample fixture data
// existing in the dev Neon branch.
const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("changes-writer", () => {
  let scenarioId: string;

  beforeEach(async () => {
    const [row] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `writer-test-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = row.id;
  });

  afterEach(async () => {
    // ON DELETE CASCADE on scenario_changes.scenario_id cleans up child rows.
    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  });

  describe("applyEntityEdit", () => {
    it("stores an expense items edit with the total the items imply", async () => {
      const [living] = await db
        .select({ id: expenses.id, scenarioId: expenses.scenarioId })
        .from(expenses)
        .innerJoin(scenarios, eq(scenarios.id, expenses.scenarioId))
        .where(
          and(
            eq(expenses.clientId, COOPER_CLIENT_ID),
            eq(scenarios.isBaseCase, true),
            eq(expenses.isDefault, true),
            eq(expenses.startYearRef, "plan_start"),
          ),
        );
      expect(living).toBeDefined();
      const items = [{ id: "i1", name: "Housing", amount: 3200, frequency: "monthly" }];

      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "expense",
        targetId: living.id,
        desiredFields: { livingItems: items, annualAmount: "1" },
      });

      const [row] = await db
        .select()
        .from(scenarioChanges)
        .where(and(eq(scenarioChanges.scenarioId, scenarioId), eq(scenarioChanges.targetId, living.id)));
      const payload = row.payload as Record<string, { to: unknown }>;
      expect(payload.livingItems.to).toEqual(items);
      expect(Number(payload.annualAmount.to)).toBe(38400);
    });

    it("inserts an edit row with field-level diff vs base", async () => {
      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        desiredFields: { annualAmount: 300000 },
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].opType).toBe("edit");
      expect(rows[0].targetKind).toBe("income");
      expect(rows[0].payload).toEqual({
        annualAmount: { from: COOPER_SALARY_BASE_AMOUNT, to: 300000 },
      });
    });

    it("upserts (updates existing edit row, no unique-constraint error)", async () => {
      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        desiredFields: { annualAmount: 300000 },
      });
      // Second call with a new value — should update, not throw.
      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        desiredFields: { annualAmount: 275000 },
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
            eq(scenarioChanges.opType, "edit"),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({
        annualAmount: { from: COOPER_SALARY_BASE_AMOUNT, to: 275000 },
      });
    });

    it("folds an edit into a prior add row (no separate edit row)", async () => {
      // Reproduces D2 (post-trust-dialog rebase smoke): adding a scenario-only
      // entity and then editing one of its fields produced two display rows in
      // <ChangesPanel> — an `add` row + a parallel `edit` row — because the
      // unique index `(scenarioId, targetKind, targetId, opType)` allowed both
      // ops to coexist. Symmetric to applyEntityRemove's add-collapse logic:
      // edit-of-add should mutate the existing add row's payload instead of
      // inserting a parallel edit.
      const newId = randomUUID();
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        entity: {
          id: newId,
          clientId: COOPER_CLIENT_ID,
          name: "Scenario Roth",
          category: "retirement",
          subType: "roth_ira",
          owner: "client",
          value: 50000,
          basis: 0,
        },
      });

      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        targetId: newId,
        desiredFields: { value: 75000 },
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, newId),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].opType).toBe("add");
      expect(rows[0].payload).toMatchObject({
        id: newId,
        name: "Scenario Roth",
        value: 75000,
        basis: 0,
      });
    });

    it("multiple edits-of-add keep collapsing into the add row", async () => {
      const newId = randomUUID();
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        entity: {
          id: newId,
          clientId: COOPER_CLIENT_ID,
          name: "Scenario Roth",
          category: "retirement",
          subType: "roth_ira",
          owner: "client",
          value: 50000,
          basis: 0,
        },
      });

      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        targetId: newId,
        desiredFields: { value: 75000 },
      });
      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        targetId: newId,
        desiredFields: { value: 100000, name: "Scenario Roth (renamed)" },
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, newId),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].opType).toBe("add");
      expect(rows[0].payload).toMatchObject({
        id: newId,
        name: "Scenario Roth (renamed)",
        value: 100000,
        basis: 0,
      });
    });

    it("idempotent revert: deletes edit row when desired matches base", async () => {
      // Step 1: create an edit.
      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        desiredFields: { annualAmount: 300000 },
      });
      // Step 2: revert by setting back to base value — row should be deleted.
      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        desiredFields: { annualAmount: COOPER_SALARY_BASE_AMOUNT },
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
          ),
        );

      expect(rows).toHaveLength(0);
    });

    it("writes a client-singleton edit row (life expectancy)", async () => {
      // Regression: editing the primary client inside a scenario sends
      // targetKind="client". The writer used to throw `unsupported
      // targetKind=client` because `client` is a singleton (no top-level
      // array), even though the engine's applyEdit handles it.
      const [c] = await db
        .select({ lifeExpectancy: clients.lifeExpectancy })
        .from(clients)
        .where(eq(clients.id, COOPER_CLIENT_ID));
      const baseLE = c.lifeExpectancy;
      const newLE = baseLE + 1;

      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "client",
        targetId: COOPER_CLIENT_ID,
        desiredFields: { lifeExpectancy: newLE },
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetKind, "client"),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].opType).toBe("edit");
      expect(rows[0].payload).toEqual({
        lifeExpectancy: { from: baseLE, to: newLE },
      });
    });

    it("drops non-overlayable fields (email/address) from a client edit", async () => {
      // The shared client form posts contact-info fields that aren't on the
      // engine's ClientInfo singleton. They aren't scenario-overlayable, so the
      // writer must keep them out of the change payload.
      const [c] = await db
        .select({ lifeExpectancy: clients.lifeExpectancy })
        .from(clients)
        .where(eq(clients.id, COOPER_CLIENT_ID));
      const newLE = c.lifeExpectancy + 2;

      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "client",
        targetId: COOPER_CLIENT_ID,
        desiredFields: {
          lifeExpectancy: newLE,
          email: "scenario@example.com",
          address: "123 Scenario St",
        },
      });

      const [row] = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetKind, "client"),
          ),
        );

      expect(row.payload).toEqual({
        lifeExpectancy: { from: c.lifeExpectancy, to: newLE },
      });
    });

    it("idempotent revert: deletes a client edit row when desired matches base", async () => {
      const [c] = await db
        .select({ lifeExpectancy: clients.lifeExpectancy })
        .from(clients)
        .where(eq(clients.id, COOPER_CLIENT_ID));

      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "client",
        targetId: COOPER_CLIENT_ID,
        desiredFields: { lifeExpectancy: c.lifeExpectancy + 3 },
      });
      // Re-submit with the base value (plus a non-overlayable field, which is
      // filtered out) — the edit row should be deleted, not left behind.
      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "client",
        targetId: COOPER_CLIENT_ID,
        desiredFields: {
          lifeExpectancy: c.lifeExpectancy,
          email: "scenario@example.com",
        },
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetKind, "client"),
          ),
        );

      expect(rows).toHaveLength(0);
    });
  });

  describe("base deductions", () => {
    it("an edit diffs against the found base row, not a phantom", async () => {
      const [base] = await db
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(and(eq(scenarios.clientId, COOPER_CLIENT_ID), eq(scenarios.isBaseCase, true)));
      const [ded] = await db
        .insert(clientDeductions)
        .values({
          clientId: COOPER_CLIENT_ID,
          scenarioId: base.id,
          type: "charitable",
          annualAmount: "12000",
          startYear: 2026,
          endYear: 2040,
        })
        .returning();
      try {
        await applyEntityEdit({
          scenarioId,
          firmId: COOPER_FIRM_ID,
          targetKind: "client_deduction",
          targetId: ded.id,
          desiredFields: { annualAmount: 20000 },
        });

        const [row] = await db
          .select()
          .from(scenarioChanges)
          .where(and(eq(scenarioChanges.scenarioId, scenarioId), eq(scenarioChanges.targetId, ded.id)));
        expect(row.payload).toEqual({ annualAmount: { from: 12000, to: 20000 } });
      } finally {
        await db.delete(clientDeductions).where(eq(clientDeductions.id, ded.id));
      }
    });
  });

  describe("merge semantics", () => {
    async function editRow() {
      const rows = await db.select().from(scenarioChanges).where(and(
        eq(scenarioChanges.scenarioId, scenarioId),
        eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
        eq(scenarioChanges.opType, "edit"),
      ));
      return rows;
    }
    const edit = (desiredFields: Record<string, unknown>, extra: Partial<ApplyEntityEditArgs> = {}) =>
      applyEntityEdit({ scenarioId, firmId: COOPER_FIRM_ID, targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID, desiredFields, ...extra });

    it("two partial saves compose into one row", async () => {
      await edit({ annualAmount: 300000 });
      await edit({ name: "Renamed salary" });
      const rows = await editRow();
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0].payload as object).sort()).toEqual(["annualAmount", "name"]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((rows[0].payload as any).annualAmount.to).toBe(300000);
    });

    it("saving one field back to base drops just that field", async () => {
      await edit({ annualAmount: 300000, name: "Renamed salary" });
      await edit({ annualAmount: COOPER_SALARY_BASE_AMOUNT });
      const rows = await editRow();
      expect(Object.keys(rows[0].payload as object)).toEqual(["name"]);
    });

    it("saving every field back to base deletes the row", async () => {
      await edit({ name: "Renamed salary" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseName = ((await editRow())[0].payload as any).name.from;
      await edit({ name: baseName });
      expect(await editRow()).toHaveLength(0);
    });

    it("a merge keeps the row's toggle group when the save doesn't name one", async () => {
      const [g] = await db.insert(scenarioToggleGroups)
        .values({ scenarioId, name: "G", defaultOn: true, orderIndex: 0 }).returning();
      await edit({ annualAmount: 300000 }, { toggleGroupId: g.id });
      await edit({ name: "Renamed salary" });
      expect((await editRow())[0].toggleGroupId).toBe(g.id);
    });

    it("two concurrent partial saves both survive", async () => {
      await Promise.all([edit({ annualAmount: 300000 }), edit({ name: "Renamed salary" })]);
      const rows = await editRow();
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0].payload as object).sort()).toEqual(["annualAmount", "name"]);
    });

    it("null and undefined compare equal, so a null save of an absent field is no diff", async () => {
      await edit({ annualAmount: 300000, notes: null });
      expect(Object.keys((await editRow())[0].payload as object)).toEqual(["annualAmount"]);
    });

    it("a save naming a different toggle group moves the merged row there", async () => {
      const [g1, g2] = await db.insert(scenarioToggleGroups).values([
        { scenarioId, name: "G1", defaultOn: true, orderIndex: 0 },
        { scenarioId, name: "G2", defaultOn: true, orderIndex: 1 },
      ]).returning();
      await edit({ annualAmount: 300000 }, { toggleGroupId: g1.id });
      await edit({ name: "Renamed salary" }, { toggleGroupId: g2.id });
      const rows = await editRow();
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0].payload as object).sort()).toEqual(["annualAmount", "name"]);
      expect(rows[0].toggleGroupId).toBe(g2.id);
    });

    it("a client-singleton merge drops a stored key the singleton doesn't carry", async () => {
      const [c] = await db
        .select({ lifeExpectancy: clients.lifeExpectancy })
        .from(clients)
        .where(eq(clients.id, COOPER_CLIENT_ID));
      // An older row written before the singleton filter carried `email`.
      await db.insert(scenarioChanges).values({
        scenarioId,
        opType: "edit",
        targetKind: "client",
        targetId: COOPER_CLIENT_ID,
        payload: {
          lifeExpectancy: { from: c.lifeExpectancy, to: c.lifeExpectancy + 1 },
          email: { from: null, to: "old@example.com" },
        },
      });
      const editClient = (lifeExpectancy: number) =>
        applyEntityEdit({ scenarioId, firmId: COOPER_FIRM_ID, targetKind: "client",
          targetId: COOPER_CLIENT_ID, desiredFields: { lifeExpectancy } });
      const clientRows = () => db.select().from(scenarioChanges).where(and(
        eq(scenarioChanges.scenarioId, scenarioId),
        eq(scenarioChanges.targetKind, "client"),
      ));

      await editClient(c.lifeExpectancy + 2);
      expect(Object.keys((await clientRows())[0].payload as object)).toEqual(["lifeExpectancy"]);
      // Back at base, nothing is left — the stray key can't block the delete.
      await editClient(c.lifeExpectancy);
      expect(await clientRows()).toHaveLength(0);
    });

    describe("plan_settings stress overrides", () => {
      // The Stress-test keys are optional engine `PlanSettings` keys the base
      // loader never sets, so they are absent from the base singleton. The
      // Solver's save-as-new path writes them straight into a plan_settings
      // edit row (save-scenario inserts it without going through the writer).
      const MARKET_SHOCK = { year: 2030, drawdownPct: 0.3 };
      const SS_HAIRCUT = { pct: 0.2, startYear: 2033 };
      const TAX_RATE_STRESS = { points: 0.03, startYear: 2030 };

      async function basePlanEndYear(): Promise<number> {
        const [ps] = await db
          .select({ planEndYear: planSettings.planEndYear })
          .from(planSettings)
          .innerJoin(scenarios, eq(scenarios.id, planSettings.scenarioId))
          .where(and(eq(planSettings.clientId, COOPER_CLIENT_ID), eq(scenarios.isBaseCase, true)));
        return ps.planEndYear;
      }
      const editPlanSettings = (desiredFields: Record<string, unknown>) =>
        applyEntityEdit({ scenarioId, firmId: COOPER_FIRM_ID, targetKind: "plan_settings",
          targetId: COOPER_CLIENT_ID, desiredFields });
      const planSettingsRows = () => db.select().from(scenarioChanges).where(and(
        eq(scenarioChanges.scenarioId, scenarioId),
        eq(scenarioChanges.targetKind, "plan_settings"),
      ));

      it("a planEndYear save keeps the stress overrides already on the row", async () => {
        const planEndYear = (await basePlanEndYear()) + 1;
        await db.insert(scenarioChanges).values({
          scenarioId,
          opType: "edit",
          targetKind: "plan_settings",
          targetId: COOPER_CLIENT_ID,
          payload: {
            marketShock: { from: null, to: MARKET_SHOCK },
            ssBenefitHaircut: { from: null, to: SS_HAIRCUT },
          },
        });

        await editPlanSettings({ planEndYear });

        const rows = await planSettingsRows();
        expect(rows).toHaveLength(1);
        expect(Object.keys(rows[0].payload as object).sort())
          .toEqual(["marketShock", "planEndYear", "ssBenefitHaircut"]);
        expect(rows[0].payload).toMatchObject({
          marketShock: { to: MARKET_SHOCK },
          ssBenefitHaircut: { to: SS_HAIRCUT },
          planEndYear: { to: planEndYear },
        });
      });

      it("a new stress override is written into an existing plan_settings row", async () => {
        const planEndYear = (await basePlanEndYear()) + 1;
        await editPlanSettings({ planEndYear });
        await editPlanSettings({ taxRateStress: TAX_RATE_STRESS });

        const rows = await planSettingsRows();
        expect(rows).toHaveLength(1);
        expect(Object.keys(rows[0].payload as object).sort())
          .toEqual(["planEndYear", "taxRateStress"]);
        expect(rows[0].payload).toMatchObject({
          planEndYear: { to: planEndYear },
          taxRateStress: { to: TAX_RATE_STRESS },
        });
      });
    });
  });

  describe("applyEntityAdd", () => {
    it("inserts an add row with the full entity payload and returns targetId", async () => {
      const newId = randomUUID();
      const result = await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        entity: {
          id: newId,
          clientId: COOPER_CLIENT_ID,
          name: "Scenario-only Roth",
          category: "retirement",
          subType: "roth_ira",
          owner: "client",
          value: 50000,
          basis: 0,
        },
      });

      expect(result.targetId).toBe(newId);

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, newId),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].opType).toBe("add");
      expect(rows[0].targetKind).toBe("account");
      expect(rows[0].payload).toMatchObject({
        id: newId,
        name: "Scenario-only Roth",
        value: 50000,
      });
    });

    it("inserts a will add row carrying the full nested bequest tree", async () => {
      // Wills are unusual: bequests + recipients are nested arrays on the
      // entity, so the add payload must round-trip the whole tree. Without
      // this path, scenario-mode WillsPanel saves silently lose new bequests
      // (the original report bug).
      const newWillId = randomUUID();
      const newBequestId = randomUUID();
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "will",
        entity: {
          id: newWillId,
          grantor: "client",
          bequests: [
            {
              id: newBequestId,
              kind: "asset",
              name: "Vacation home to Co-client",
              assetMode: "specific",
              accountId: null,
              liabilityId: null,
              percentage: 100,
              condition: "always",
              sortOrder: 0,
              recipients: [
                {
                  recipientKind: "spouse",
                  recipientId: null,
                  percentage: 100,
                  sortOrder: 0,
                },
              ],
            },
          ],
          residuaryRecipients: [],
        },
      });

      const [row] = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, newWillId),
          ),
        );

      expect(row).toBeDefined();
      expect(row.opType).toBe("add");
      expect(row.targetKind).toBe("will");
      const payload = row.payload as {
        bequests: Array<{ id: string; recipients: unknown[] }>;
      };
      expect(payload.bequests).toHaveLength(1);
      expect(payload.bequests[0].id).toBe(newBequestId);
      expect(payload.bequests[0].recipients).toHaveLength(1);
    });
  });

  describe("applyEntityRemove", () => {
    it("deletes the add row when entity was scenario-added", async () => {
      const newId = randomUUID();
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        entity: {
          id: newId,
          clientId: COOPER_CLIENT_ID,
          name: "Temp account",
          category: "taxable",
          subType: "brokerage",
          owner: "client",
          value: 1000,
          basis: 0,
        },
      });

      // Now remove — since it was scenario-added, the add row should be deleted
      // (no remove row inserted).
      await applyEntityRemove({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        targetId: newId,
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, newId),
          ),
        );

      expect(rows).toHaveLength(0);
    });

    // Removing a scenario-ADDED business drops its own rows; an ordinary child
    // (a sibling `add` whose parentAccountId is the business's synthetic id)
    // survives. Left pointing at a parent that will never exist, it FK-failed
    // every later promote. Base deletes with ON DELETE SET NULL, and
    // resolveCascades releases the child the same way — so does the writer.
    // The business's own "<name> — Cash" default checking is part of the
    // business and goes with it.
    it("removing a scenario-added business deletes its cash and nulls its other children's parentAccountId", async () => {
      const businessId = randomUUID();
      const defaultCashId = randomUUID();
      const cashId = randomUUID();
      const loanId = randomUUID();
      const otherId = randomUUID();
      const add = (targetKind: "account" | "liability", entity: Record<string, unknown>) =>
        applyEntityAdd({ scenarioId, firmId: COOPER_FIRM_ID, targetKind, entity: entity as never });
      await add("account", { id: businessId, name: "Acme", category: "business", value: 0, basis: 0 });
      await add("account", {
        id: defaultCashId,
        name: "Acme — Cash",
        category: "cash",
        parentAccountId: businessId,
        isDefaultChecking: true,
        value: 0,
        basis: 0,
      });
      await add("account", {
        id: cashId,
        name: "Acme Reserve",
        category: "cash",
        parentAccountId: businessId,
        value: 0,
        basis: 0,
      });
      await add("liability", { id: loanId, name: "Acme LOC", balance: 0, parentAccountId: businessId });
      await add("account", {
        id: otherId,
        name: "Unrelated",
        category: "taxable",
        parentAccountId: null,
        value: 0,
        basis: 0,
      });

      await applyEntityRemove({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        targetId: businessId,
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(eq(scenarioChanges.scenarioId, scenarioId));
      const byTarget = new Map(rows.map((r) => [r.targetId, r]));
      expect(byTarget.has(businessId)).toBe(false);
      expect(byTarget.has(defaultCashId)).toBe(false);
      const cash = byTarget.get(cashId)!.payload as Record<string, unknown>;
      expect(cash.parentAccountId).toBeNull();
      expect(cash.name).toBe("Acme Reserve"); // the rest of the payload is untouched
      expect((byTarget.get(loanId)!.payload as Record<string, unknown>).parentAccountId).toBeNull();
      expect(byTarget.get(otherId)!.payload).toMatchObject({ name: "Unrelated", parentAccountId: null });
      expect(rows).toHaveLength(3);
    });

    it("inserts a remove row when entity exists in base", async () => {
      await applyEntityRemove({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].opType).toBe("remove");
      expect(rows[0].payload).toBeNull();
    });
  });

  // Ruling F-I1: `toggleGroupId` undefined means "didn't say" — a re-save that
  // omits it keeps the row's group; only an explicit null unlinks it. Every
  // Details editor re-saves without a group id, so treating omission as
  // "unlink" silently pulled grouped changes out of their group (always on).
  describe("toggle-group link on re-save", () => {
    async function makeGroup(): Promise<string> {
      const [group] = await db
        .insert(scenarioToggleGroups)
        .values({ scenarioId, name: "Writer test group" })
        .returning();
      return group.id;
    }

    async function groupOf(targetId: string, opType: "add" | "edit" | "remove") {
      const [row] = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, targetId),
            eq(scenarioChanges.opType, opType),
          ),
        );
      return row?.toggleGroupId;
    }

    const salaryEdit = (annualAmount: number) => ({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "income" as const,
      targetId: COOPER_SALARY_INCOME_ID,
      desiredFields: { annualAmount },
    });

    it("an edit re-saved without a group id keeps its group", async () => {
      const groupId = await makeGroup();
      await applyEntityEdit({ ...salaryEdit(300000), toggleGroupId: groupId });

      await applyEntityEdit(salaryEdit(275000));

      expect(await groupOf(COOPER_SALARY_INCOME_ID, "edit")).toBe(groupId);
    });

    it("an edit re-saved with an explicit null leaves its group", async () => {
      const groupId = await makeGroup();
      await applyEntityEdit({ ...salaryEdit(300000), toggleGroupId: groupId });

      await applyEntityEdit({ ...salaryEdit(275000), toggleGroupId: null });

      expect(await groupOf(COOPER_SALARY_INCOME_ID, "edit")).toBeNull();
    });

    it("a new edit row with no group id is ungrouped", async () => {
      await applyEntityEdit(salaryEdit(300000));

      expect(await groupOf(COOPER_SALARY_INCOME_ID, "edit")).toBeNull();
    });

    it("an add re-saved without a group id keeps its group", async () => {
      // A gift's every save is an `add` (lib/gifts/gift-write.ts), so a
      // re-save lands on this upsert's conflict branch.
      const groupId = await makeGroup();
      const entity = {
        id: randomUUID(),
        clientId: COOPER_CLIENT_ID,
        name: "Grouped account",
        category: "taxable",
        subType: "brokerage",
        owner: "client",
        value: 1000,
        basis: 0,
      };
      const add = { scenarioId, firmId: COOPER_FIRM_ID, targetKind: "account" as const };
      await applyEntityAdd({ ...add, entity, toggleGroupId: groupId });

      await applyEntityAdd({ ...add, entity: { ...entity, value: 2000 } });

      expect(await groupOf(entity.id, "add")).toBe(groupId);
    });

    it("a remove re-saved without a group id keeps its group", async () => {
      const groupId = await makeGroup();
      const remove = {
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "income" as const,
        targetId: COOPER_SALARY_INCOME_ID,
      };
      await applyEntityRemove({ ...remove, toggleGroupId: groupId });

      await applyEntityRemove(remove);

      expect(await groupOf(COOPER_SALARY_INCOME_ID, "remove")).toBe(groupId);
    });
  });

  describe("firm scoping", () => {
    it("applyEntityEdit throws ForbiddenError when firmId doesn't own the scenario", async () => {
      await expect(
        applyEntityEdit({
          scenarioId,
          firmId: "org_not_cooper",
          targetKind: "income",
          targetId: COOPER_SALARY_INCOME_ID,
          desiredFields: { annualAmount: 300000 },
        }),
      ).rejects.toThrow(/not accessible/);

      // No row should have been written.
      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(eq(scenarioChanges.scenarioId, scenarioId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("revertChange", () => {
    it("deletes the matching change row", async () => {
      await applyEntityEdit({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        desiredFields: { annualAmount: 300000 },
      });

      await revertChange({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        opType: "edit",
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
          ),
        );

      expect(rows).toHaveLength(0);
    });

    it("reverting a scenario-added business un-adds its cash and releases its other children", async () => {
      const businessId = randomUUID();
      const defaultCashId = randomUUID();
      const reserveId = randomUUID();
      const add = (entity: Record<string, unknown>) =>
        applyEntityAdd({ scenarioId, firmId: COOPER_FIRM_ID, targetKind: "account", entity: entity as never });
      await add({ id: businessId, name: "Acme", category: "business", value: 0, basis: 0 });
      await add({
        id: defaultCashId,
        name: "Acme — Cash",
        category: "cash",
        parentAccountId: businessId,
        isDefaultChecking: true,
        value: 0,
        basis: 0,
      });
      await add({ id: reserveId, name: "Acme Reserve", category: "cash", parentAccountId: businessId, value: 0, basis: 0 });

      await revertChange({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "account",
        targetId: businessId,
        opType: "add",
      });

      const rows = await db
        .select()
        .from(scenarioChanges)
        .where(eq(scenarioChanges.scenarioId, scenarioId));
      expect(rows.map((r) => r.targetId)).toEqual([reserveId]);
      expect((rows[0].payload as Record<string, unknown>).parentAccountId).toBeNull();
    });
  });
});
