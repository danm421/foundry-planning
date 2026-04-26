// src/lib/scenario/snapshot.ts
//
// Server-side writer + reader for scenario_snapshots. A snapshot freezes the
// pair of effective trees (left + right) plus enough raw data (right-side
// changes + toggle groups, toggle state) to "rehydrate" the comparison later
// even after the source scenario is edited or deleted.
//
// Per spec §3.1, snapshots intentionally have no FK on
// left_scenario_id/right_scenario_id — they survive scenario deletion as
// orphan ids. Firm scoping inherits via client_id → clients.firm_id; this
// writer relies on `loadEffectiveTreeForRef` to enforce that on read.

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  scenarioChanges,
  scenarioSnapshots,
  scenarioToggleGroups,
} from "@/db/schema";
import { loadEffectiveTreeForRef, type ScenarioRef } from "./loader";

export interface CreateSnapshotInput {
  clientId: string;
  /**
   * Used by `loadEffectiveTreeForRef` to scope the snapshot's frozen trees to
   * the caller's firm. NOT inserted into the row — the table has no firmId
   * column; firm scoping is inherited via the parent client.
   */
  firmId: string;
  leftRef: ScenarioRef;
  rightRef: ScenarioRef;
  name: string;
  description?: string;
  sourceKind: "manual" | "pdf_export";
  /**
   * Clerk user id (e.g., `user_2qXyZ...`). Stored as text — see migration 0053.
   */
  userId: string;
}

/**
 * Freeze a (leftRef, rightRef) pair into a snapshot row. Captures both
 * effective trees verbatim plus, when right is a non-base live scenario, the
 * raw scenario_changes + scenario_toggle_groups rows that produced it.
 *
 * Returns the inserted row.
 */
export async function createSnapshot(input: CreateSnapshotInput) {
  const [{ effectiveTree: left }, { effectiveTree: right }] = await Promise.all([
    loadEffectiveTreeForRef(input.clientId, input.firmId, input.leftRef),
    loadEffectiveTreeForRef(input.clientId, input.firmId, input.rightRef),
  ]);

  // Resolve scenario ids once. A non-base live scenario id is also the only
  // case where we have raw_changes / raw_toggle_groups to freeze — base and
  // snapshot refs leave those empty.
  const leftScenarioId = liveScenarioId(input.leftRef);
  const rightScenarioId = liveScenarioId(input.rightRef);

  const [rawChanges, rawToggleGroups] = rightScenarioId
    ? await Promise.all([
        db
          .select()
          .from(scenarioChanges)
          .where(eq(scenarioChanges.scenarioId, rightScenarioId)),
        db
          .select()
          .from(scenarioToggleGroups)
          .where(eq(scenarioToggleGroups.scenarioId, rightScenarioId)),
      ])
    : [[], []];

  const toggleState =
    input.rightRef.kind === "scenario" ? input.rightRef.toggleState : {};

  const [created] = await db
    .insert(scenarioSnapshots)
    .values({
      clientId: input.clientId,
      name: input.name,
      description: input.description ?? null,
      leftScenarioId,
      rightScenarioId,
      effectiveTreeLeft: left,
      effectiveTreeRight: right,
      toggleState,
      rawChangesRight: rawChanges,
      rawToggleGroupsRight: rawToggleGroups,
      sourceKind: input.sourceKind,
      frozenByUserId: input.userId,
    })
    .returning();

  return created;
}

/**
 * Returns a live (non-base) scenario uuid for refs that point at one,
 * otherwise null. Snapshot refs and base-case refs both yield null — neither
 * has a "source scenario" to record on the snapshot row.
 */
function liveScenarioId(ref: ScenarioRef): string | null {
  if (ref.kind !== "scenario") return null;
  if (ref.id === "base") return null;
  return ref.id;
}

/** Read a snapshot row by id. Throws if not found. */
export async function readSnapshot(id: string) {
  const [row] = await db
    .select()
    .from(scenarioSnapshots)
    .where(eq(scenarioSnapshots.id, id));
  if (!row) {
    throw new Error(`Snapshot ${id} not found`);
  }
  return row;
}
