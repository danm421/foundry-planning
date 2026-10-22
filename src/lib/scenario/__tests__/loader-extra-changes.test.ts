// loadEffectiveTree folds extra (held, unsaved) changes over the saved ones.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarioChanges, scenarios } from "@/db/schema";
import type { ScenarioChange } from "@/engine/scenario/types";
import { loadEffectiveTree } from "../loader";

const TEST_FIRM_ID = process.env.TEST_FIRM_ID;
const TEST_CLIENT_ID = process.env.TEST_CLIENT_ID;

function expensePayload(id: string, annualAmount: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "living",
    name: "Held test expense",
    annualAmount,
    startYear: 2030,
    endYear: 2040,
    growthSource: "custom",
    growthRate: "0.04",
    ...extra,
  };
}

function held(
  opType: ScenarioChange["opType"],
  targetKind: ScenarioChange["targetKind"],
  targetId: string,
  payload: unknown,
  orderIndex = 0,
): ScenarioChange {
  return {
    id: `held:${targetKind}:${targetId}`,
    scenarioId: "held",
    opType,
    targetKind,
    targetId,
    payload,
    toggleGroupId: null,
    orderIndex,
  };
}

describe.skipIf(!TEST_FIRM_ID || !TEST_CLIENT_ID)("loadEffectiveTree — extraChanges", () => {
  let scenarioId: string;
  const savedExpenseId = randomUUID();

  beforeAll(async () => {
    const [scn] = await db
      .insert(scenarios)
      .values({ clientId: TEST_CLIENT_ID!, name: "loader-extra-changes-test", isBaseCase: false })
      .returning();
    scenarioId = scn.id;
    await db.insert(scenarioChanges).values({
      scenarioId,
      opType: "add",
      targetKind: "expense",
      targetId: savedExpenseId,
      payload: expensePayload(savedExpenseId, "1000"),
      toggleGroupId: null,
      orderIndex: 0,
    });
  });

  afterAll(async () => {
    // scenario_changes rows go with the scenario (ON DELETE CASCADE).
    if (scenarioId) await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  });

  it("base + a held expense add shows the expense, resolved", async () => {
    const [base] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, TEST_CLIENT_ID!), eq(scenarios.isBaseCase, true)));
    const id = randomUUID();
    const { effectiveTree } = await loadEffectiveTree(TEST_CLIENT_ID!, TEST_FIRM_ID!, base.id, {}, [
      held("add", "expense", id, expensePayload(id, "2500")),
    ]);
    const found = effectiveTree.expenses.find((e) => e.id === id);
    expect(found).toBeDefined();
    expect(found!.annualAmount).toBe(2500);
    expect(found!.growthRate).toBeCloseTo(0.04);
  });

  it("a held edit of a saved scenario add folds into it", async () => {
    const { effectiveTree } = await loadEffectiveTree(TEST_CLIENT_ID!, TEST_FIRM_ID!, scenarioId, {}, [
      held("edit", "expense", savedExpenseId, { annualAmount: { from: 1000, to: 3300 } }),
    ]);
    const matches = effectiveTree.expenses.filter((e) => e.id === savedExpenseId);
    expect(matches).toHaveLength(1);
    expect(matches[0].annualAmount).toBe(3300);
  });

  it("a held plan_settings inflationRate edit re-resolves inflation-sourced growth", async () => {
    const id = randomUUID();
    const add = held(
      "add",
      "expense",
      id,
      expensePayload(id, "1000", { growthSource: "inflation", growthRate: null }),
      0,
    );
    const without = await loadEffectiveTree(TEST_CLIENT_ID!, TEST_FIRM_ID!, scenarioId, {}, [add]);
    const withEdit = await loadEffectiveTree(TEST_CLIENT_ID!, TEST_FIRM_ID!, scenarioId, {}, [
      add,
      held("edit", "plan_settings", "plan_settings", {
        inflationRateSource: { from: "asset_class", to: "custom" },
        inflationRate: { from: 0.03, to: 0.071 },
      }, 1),
    ]);
    expect(withEdit.effectiveTree.planSettings.inflationRate).toBeCloseTo(0.071);
    expect(withEdit.effectiveTree.expenses.find((e) => e.id === id)!.growthRate).toBeCloseTo(0.071);
    expect(without.effectiveTree.expenses.find((e) => e.id === id)!.growthRate).not.toBeCloseTo(0.071);
  });
});
