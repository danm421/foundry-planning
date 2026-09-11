// src/lib/scenario/promote-to-base-types.ts
//
// Data structures describing the writes a promote operation applies to the
// base-case rows. Produced by the pure classifier (scenarioChangesToBaseWrites)
// and consumed by the IO executor inside the promote transaction.
import type { TargetKind } from "@/engine/scenario/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

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

/**
 * The `gift` changes that belong to `gift_series` rather than to `gifts`.
 *
 * `gift_series` is scenario-PARTITIONED (the loader reads it filtered by
 * scenarioId) and is deliberately NOT a TargetKind, so a series-shaped `gift`
 * change cannot go through the one-table-per-kind executor at all. These ops
 * are applied to the PROMOTED SCENARIO's own partition — not to base — and the
 * existing base delete+copy then carries that partition across. Both halves
 * live in `copyGiftSeriesToBase`, because the order between them is the whole
 * correctness argument.
 */
export interface GiftSeriesWrites {
  /** `id` is the change's targetId — the row id in the scenario's partition.
   *  A series draft has no `year`, so it can only ever be a series row. */
  upserts: { id: string; draft: EstateFlowGift }[];
  /** Partition row ids to delete: every `gift` remove (deleting a series id
   *  from `gifts` matches nothing, so no lookup is needed to tell them apart)
   *  and every series `add` the advisor toggled OFF. */
  removes: string[];
}

export interface BaseWritePlan {
  inserts: BaseInsert[];
  updates: BaseUpdate[];
  singletonUpdates: BaseSingletonUpdate[];
  removes: BaseRemove[];
  giftSeries: GiftSeriesWrites;
}
