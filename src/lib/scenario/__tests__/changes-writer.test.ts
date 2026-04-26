// src/lib/scenario/__tests__/changes-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioChanges } from "@/db/schema";
import {
  applyEntityEdit,
  applyEntityAdd,
  applyEntityRemove,
  revertChange,
} from "../changes-writer";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const COOPER_SALARY_INCOME_ID = "d99f3ccb-8eb5-44f9-ae81-f52fb2694458";
const COOPER_SALARY_BASE_AMOUNT = 250000;

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
  });
});
