// src/lib/scenario/promote-to-base-types.ts
//
// Data structures describing the writes a promote operation applies to the
// base-case rows. Produced by the pure classifier (scenarioChangesToBaseWrites)
// and consumed by the IO executor inside the promote transaction.
import type { TargetKind } from "@/engine/scenario/types";

/** One array-kind row to INSERT into its base table. `raw` is the scenario
 *  change's add payload (raw form/DB shape — refs and growth-sources intact).
 *  `targetId` is the scenario-invented uuid; the executor remaps it to the
 *  DB-generated uuid and rewrites dependent references. */
export interface BaseInsert {
  kind: TargetKind;
  targetId: string;
  raw: Record<string, unknown>;
}

/** Partial-column UPDATE to an existing base row (from an `edit` change).
 *  `set` holds only the changed columns' `to` values (raw shape). */
export interface BaseUpdate {
  kind: TargetKind;
  id: string;
  set: Record<string, unknown>;
}

/** A base row to DELETE — either an explicit `remove` change or a cascade drop. */
export interface BaseRemove {
  kind: TargetKind;
  id: string;
  /** true when this came from a CascadeWarning rather than a remove change. */
  cascade: boolean;
}

/** Singleton edits (client, plan_settings) — UPDATE the single base row. */
export interface BaseSingletonUpdate {
  kind: "client" | "plan_settings";
  set: Record<string, unknown>;
}

export interface BaseWritePlan {
  inserts: BaseInsert[];
  updates: BaseUpdate[];
  singletonUpdates: BaseSingletonUpdate[];
  removes: BaseRemove[];
}
