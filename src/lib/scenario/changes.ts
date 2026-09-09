// src/lib/scenario/changes.ts
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarioChanges, scenarioToggleGroups } from "@/db/schema";
import { resolveEffectiveToggleState } from "@/engine/scenario/applyChanges";
import type {
  ScenarioChange,
  TargetKind,
  ToggleGroup,
} from "@/engine/scenario/types";

// Filters out rows where `enabled = false` so disabled changes never reach
// the engine. The Changes panel's own queries fetch all rows directly so the
// disabled rows still render with the toggle in the off position.
//
// Request-memoized (same pattern as `loadEffectiveTree`): a page that runs the
// projection AND reads the same scenario's changes for a view list would
// otherwise issue these queries twice. Safe because every caller reads before
// it writes — a route that wrote changes and then re-read them in the same
// request would get the pre-write rows.
export const loadScenarioChanges = cache(async function loadScenarioChanges(
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
});

/** Request-memoized — see the note on `loadScenarioChanges`. */
export const loadScenarioToggleGroups = cache(async function loadScenarioToggleGroups(
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
});

/**
 * The scenario's `gift` changes, already narrowed to the ones a projection
 * would honour (row `enabled`, plus effective toggle-group state). This is the
 * exact subset `loadEffectiveTree` hands to `applyGiftOverlays`, exported so
 * the *editor* read paths — which render DB rows / drafts rather than the
 * projection tree — can overlay the same set and stay in agreement with it.
 */
export async function loadActiveGiftChanges(
  scenarioId: string,
): Promise<ScenarioChange[]> {
  const [changes, groups] = await Promise.all([
    loadScenarioChanges(scenarioId),
    loadScenarioToggleGroups(scenarioId),
  ]);
  const effective = resolveEffectiveToggleState({}, groups);
  return changes.filter(
    (c) =>
      c.targetKind === "gift" &&
      (c.toggleGroupId == null || effective[c.toggleGroupId] === true),
  );
}
