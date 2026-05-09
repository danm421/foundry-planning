// src/lib/scenario/__tests__/changes.test.ts
//
// Integration tests for `loadScenarioChanges` — the loader the engine uses
// to materialize the scenario diff. Only enabled rows should be returned;
// disabled rows are dropped at the SQL layer so they never reach the engine.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioChanges } from "@/db/schema";
import { loadScenarioChanges } from "../changes";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_SALARY_INCOME_ID = "d99f3ccb-8eb5-44f9-ae81-f52fb2694458";
const SECOND_INCOME_ID = "f7a92f0e-1d7d-4e26-9b2f-bf8f6c7d2f10";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("loadScenarioChanges enabled-flag filter", () => {
  let scenarioId: string;

  beforeEach(async () => {
    const [row] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `load-changes-test-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = row.id;
  });

  afterEach(async () => {
    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  });

  it("includes enabled rows and excludes disabled rows", async () => {
    const [enabledRow] = await db
      .insert(scenarioChanges)
      .values({
        scenarioId,
        opType: "edit",
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        payload: { annualAmount: { from: 250000, to: 300000 } },
        toggleGroupId: null,
        orderIndex: 0,
        enabled: true,
      })
      .returning();

    // Use a different (target, op) tuple so the unique constraint
    // (scenario_id, target_kind, target_id, op_type) is not violated.
    const [disabledRow] = await db
      .insert(scenarioChanges)
      .values({
        scenarioId,
        opType: "edit",
        targetKind: "income",
        targetId: SECOND_INCOME_ID,
        payload: { annualAmount: { from: 100000, to: 200000 } },
        toggleGroupId: null,
        orderIndex: 1,
        enabled: false,
      })
      .returning();

    const loaded = await loadScenarioChanges(scenarioId);
    const ids = loaded.map((c) => c.id);
    expect(ids).toContain(enabledRow.id);
    expect(ids).not.toContain(disabledRow.id);
  });

  it("flipping enabled true → false removes the row from the loader output", async () => {
    const [row] = await db
      .insert(scenarioChanges)
      .values({
        scenarioId,
        opType: "edit",
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        payload: { annualAmount: { from: 250000, to: 300000 } },
        toggleGroupId: null,
        orderIndex: 0,
        enabled: true,
      })
      .returning();

    expect((await loadScenarioChanges(scenarioId)).map((c) => c.id)).toContain(row.id);

    await db
      .update(scenarioChanges)
      .set({ enabled: false })
      .where(eq(scenarioChanges.id, row.id));

    expect((await loadScenarioChanges(scenarioId)).map((c) => c.id)).not.toContain(row.id);
  });
});
