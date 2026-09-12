// src/lib/scenario/promote-direct-tables.ts
//
// Promote handling for scenario-scoped satellite tables that are NOT modelled as
// scenario_changes overlays. Each is a per-scenario *independent* table (the
// loader reads it filtered by scenarioId), so "promote scenario S to base" means
// making the base scenario's rows equal S's:
//
//   - entity/account flow overrides + gift_series: replace base's set with copies
//     of S's rows (delete base rows, then copy S's rows re-scoped to base).
//     `gift_series` has a second input: the solver records a recurring series as
//     a `gift` scenario change, so S's series-shaped changes are folded into S's
//     OWN partition first, and the copy then carries the result (see
//     copyGiftSeriesToBase).
//   - notes_receivable: notes always live on the BASE scenario already, gated by a
//     toggle group owned by S. Resolve each gated note against S's effective toggle
//     state in place — make it permanent (toggleGroupId = null) when active, delete
//     it when inactive or gated by a foreign scenario. (After sibling deletion the
//     FK's ON DELETE SET NULL would otherwise wrongly make OFF-gated notes
//     permanent, so this must run inside the promote tx before siblings are dropped.)
import { and, eq, isNotNull } from "drizzle-orm";
import {
  accountFlowOverrides,
  entityFlowOverrides,
  giftSeries,
  notesReceivable,
} from "@/db/schema";
import { resolveEffectiveToggleState } from "@/engine/scenario/applyChanges";
import type { ToggleGroup, ToggleState } from "@/engine/scenario/types";
import { giftDraftToSeriesRow } from "@/lib/gifts/scenario-rows";
import type { PromoteTx } from "./promote-table-registry";
import type { GiftSeriesWrites } from "./promote-to-base-types";
import { coerceForTable } from "./promote-coerce";

interface CopyCtx {
  clientId: string;
  scenarioId: string;
  baseScenarioId: string;
}

/** Drop generated/identity fields so a selected row can be re-inserted under a
 *  new scenario with a fresh id and timestamps. */
function reScope(
  row: Record<string, unknown>,
  baseScenarioId: string,
): Record<string, unknown> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
  void _id;
  void _c;
  void _u;
  return { ...rest, scenarioId: baseScenarioId };
}

/** Replace the base scenario's entity + account flow overrides with copies of
 *  the promoted scenario's rows. */
export async function copyFlowOverridesToBase(
  tx: PromoteTx,
  ctx: CopyCtx,
): Promise<void> {
  for (const table of [entityFlowOverrides, accountFlowOverrides]) {
    await tx
      .delete(table)
      .where(eq(table.scenarioId, ctx.baseScenarioId));
    const rows = await tx
      .select()
      .from(table)
      .where(eq(table.scenarioId, ctx.scenarioId));
    for (const row of rows) {
      await tx
        .insert(table)
        .values(reScope(row as Record<string, unknown>, ctx.baseScenarioId) as never);
    }
  }
}

/** The promoted scenario's series-shaped `gift` changes, plus the executor's
 *  synthetic→generated id map — a series to a trust the SAME scenario created
 *  names that trust by an id that only exists in `idRemap`. Required, not
 *  optional: a caller that forgot it would silently promote a stale series. */
export interface GiftSeriesStep extends GiftSeriesWrites {
  idRemap: ReadonlyMap<string, string>;
}

/**
 * Make the base scenario's `gift_series` equal what the promoted scenario
 * SHOWS, in two halves that must run in this order:
 *
 *   1. fold S's series-shaped `gift` changes into S's OWN partition, and
 *   2. replace base's rows with copies of that partition.
 *
 * The projection composes the same two inputs the same way (partition rows,
 * then the gift-change overlay), so promoting reproduces what the advisor saw.
 *
 * The order is why this is ONE function rather than two calls in
 * `promote-to-base.ts`: reversed, the changes would land in a partition that
 * has already been copied and never reach base at all — an invariant held by
 * two adjacent statements is one a later edit reorders by accident.
 *
 * It must be S's partition and not base's: `reScope` DROPS the row id, so
 * base's copies get fresh uuids. A write to base after the copy could neither
 * update nor delete by the change's targetId, and a series present in both the
 * partition and a change row would land twice.
 */
export async function copyGiftSeriesToBase(
  tx: PromoteTx,
  ctx: CopyCtx,
  series: GiftSeriesStep,
): Promise<void> {
  await applySeriesChangesToPartition(tx, ctx, series);
  await copyPartitionToBase(tx, ctx);
}

/** The three FK columns a `gift_series` row can carry, all mutually exclusive
 *  (`gift_series_one_recipient`). The executor's own REF_COLUMNS list covers
 *  the 18 promotable kinds' payloads and `gift_series` is not one of them, so
 *  this table's remap is stated here, where the row is built. */
const RECIPIENT_COLUMNS = [
  "recipientEntityId",
  "recipientFamilyMemberId",
  "recipientExternalBeneficiaryId",
];

/** Apply S's series-shaped `gift` changes to S's own partition. Removes run
 *  first, so an id that is both removed and re-added ends up PRESENT — the same
 *  answer `applyGiftOverlays` gives, which strips every targeted id and then
 *  re-materialises each `add`. */
async function applySeriesChangesToPartition(
  tx: PromoteTx,
  ctx: CopyCtx,
  series: GiftSeriesStep,
): Promise<void> {
  const scoped = (id: string) =>
    and(
      eq(giftSeries.id, id),
      eq(giftSeries.clientId, ctx.clientId),
      eq(giftSeries.scenarioId, ctx.scenarioId),
    );

  for (const id of series.removes) {
    await tx.delete(giftSeries).where(scoped(id));
  }

  for (const { id, draft } of series.upserts) {
    const row = giftDraftToSeriesRow(draft);
    // Unreachable: the classifier routes only `kind: "series"` drafts here.
    // Named rather than skipped, because a silently dropped gift is the one
    // outcome this whole path exists to prevent.
    if (row === null) {
      throw new Error(`promote: gift ${id} is not a recurring gift series`);
    }

    // `notes`, `startYearRef` and `endYearRef` are absent from the mapper's
    // output and MUST STAY absent — `EstateFlowGift` cannot represent any of
    // them, and `coerceForTable` skips keys the payload does not carry, so an
    // INSERT takes the column default (as today) while an UPDATE leaves the
    // advisor's note and milestone anchor alone. DO NOT "restore" them as null.
    // `valuationDiscount` is different: the draft DOES represent it, so writing
    // its null is the advisor clearing the discount.
    const values: Record<string, unknown> = {
      ...coerceForTable(giftSeries, remapRecipient(row, series.idRemap)),
      // Scope always comes from ctx, never from the payload.
      clientId: ctx.clientId,
      scenarioId: ctx.scenarioId,
    };

    // Scoped UPDATE first, INSERT only when nothing matched — the posture
    // `upsertPreservingId` uses for `gifts` (execute-base-write-plan.ts). The
    // id comes from the CHANGE, which is advisor-supplied, so the scoping is
    // load-bearing: a row owned by another client can never match, and a
    // foreign id falls through to the insert and collides loudly on the
    // primary key instead of rewriting somebody else's series.
    const set = { ...values };
    delete set.id;
    const [updated] = await tx
      .update(giftSeries)
      .set({ ...set, updatedAt: new Date() } as never)
      .where(scoped(id))
      .returning({ id: giftSeries.id });
    if (updated) continue;

    await tx.insert(giftSeries).values({ ...values, id } as never);
  }
}

/** Replace the base scenario's gift_series rows with copies of the promoted
 *  scenario's rows (gift_series is a per-scenario independent table). */
async function copyPartitionToBase(tx: PromoteTx, ctx: CopyCtx): Promise<void> {
  await tx
    .delete(giftSeries)
    .where(
      and(
        eq(giftSeries.clientId, ctx.clientId),
        eq(giftSeries.scenarioId, ctx.baseScenarioId),
      ),
    );
  const rows = await tx
    .select()
    .from(giftSeries)
    .where(
      and(
        eq(giftSeries.clientId, ctx.clientId),
        eq(giftSeries.scenarioId, ctx.scenarioId),
      ),
    );
  for (const row of rows) {
    await tx
      .insert(giftSeries)
      .values(reScope(row as Record<string, unknown>, ctx.baseScenarioId) as never);
  }
}

/** Point a series row at the recipient's REAL id when that recipient is a
 *  trust/member the same promote just created under a generated uuid. */
function remapRecipient(
  row: Record<string, unknown>,
  idRemap: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const out = { ...row };
  for (const col of RECIPIENT_COLUMNS) {
    const v = out[col];
    if (typeof v === "string" && idRemap.has(v)) out[col] = idRemap.get(v);
  }
  return out;
}

interface ResolveNotesCtx {
  clientId: string;
  baseScenarioId: string;
  toggleState: ToggleState;
  groups: ToggleGroup[];
}

/** Resolve toggle-gated notes_receivable on the base scenario against the
 *  promoted scenario's effective toggle state: active → make permanent
 *  (toggleGroupId = null); inactive or foreign-gated → delete (children cascade).
 *  Notes with toggleGroupId already null (user-entered, always-visible) are left
 *  untouched. Returns counts for the audit metadata. */
export async function resolveToggleGatedNotesOnBase(
  tx: PromoteTx,
  ctx: ResolveNotesCtx,
): Promise<{ kept: number; dropped: number }> {
  const effective = resolveEffectiveToggleState(ctx.toggleState, ctx.groups);
  const gated = await tx
    .select()
    .from(notesReceivable)
    .where(
      and(
        eq(notesReceivable.clientId, ctx.clientId),
        eq(notesReceivable.scenarioId, ctx.baseScenarioId),
        isNotNull(notesReceivable.toggleGroupId),
      ),
    );

  let kept = 0;
  let dropped = 0;
  for (const note of gated as Array<{ id: string; toggleGroupId: string | null }>) {
    const groupId = note.toggleGroupId;
    const active = groupId != null && effective[groupId] === true;
    if (active) {
      await tx
        .update(notesReceivable)
        .set({ toggleGroupId: null, updatedAt: new Date() } as never)
        .where(eq(notesReceivable.id, note.id));
      kept += 1;
    } else {
      await tx.delete(notesReceivable).where(eq(notesReceivable.id, note.id));
      dropped += 1;
    }
  }
  return { kept, dropped };
}
