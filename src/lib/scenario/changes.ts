// src/lib/scenario/changes.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarioChanges, scenarioToggleGroups } from "@/db/schema";
import type {
  ScenarioChange,
  TargetKind,
  ToggleGroup,
} from "@/engine/scenario/types";

export async function loadScenarioChanges(
  scenarioId: string,
): Promise<ScenarioChange[]> {
  const rows = await db
    .select()
    .from(scenarioChanges)
    .where(eq(scenarioChanges.scenarioId, scenarioId));

  return rows.map((r) => ({
    id: r.id,
    scenarioId: r.scenarioId,
    opType: r.opType,
    targetKind: r.targetKind as TargetKind,
    targetId: r.targetId,
    payload: r.payload,
    toggleGroupId: r.toggleGroupId,
    orderIndex: r.orderIndex,
  }));
}

export async function loadScenarioToggleGroups(
  scenarioId: string,
): Promise<ToggleGroup[]> {
  const rows = await db
    .select()
    .from(scenarioToggleGroups)
    .where(eq(scenarioToggleGroups.scenarioId, scenarioId));

  return rows.map((r) => ({
    id: r.id,
    scenarioId: r.scenarioId,
    name: r.name,
    defaultOn: r.defaultOn,
    requiresGroupId: r.requiresGroupId,
    orderIndex: r.orderIndex,
  }));
}
