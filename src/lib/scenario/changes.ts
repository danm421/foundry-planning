// src/lib/scenario/changes.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarioChanges, scenarioToggleGroups } from "@/db/schema";
import type {
  ScenarioChange,
  TargetKind,
  ToggleGroup,
} from "@/engine/scenario/types";

// Filters out rows where `enabled = false` so disabled changes never reach
// the engine. The Changes panel's own queries fetch all rows directly so the
// disabled rows still render with the toggle in the off position.
export async function loadScenarioChanges(
  scenarioId: string,
): Promise<ScenarioChange[]> {
  const rows = await db
    .select()
    .from(scenarioChanges)
    .where(
      and(eq(scenarioChanges.scenarioId, scenarioId), eq(scenarioChanges.enabled, true)),
    );

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
