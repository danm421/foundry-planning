// src/lib/scenario/promote-direct-tables.ts
//
// Promote handling for scenario-scoped satellite tables that are NOT modelled as
// scenario_changes overlays. Each is a per-scenario *independent* table (the
// loader reads it filtered by scenarioId), so "promote scenario S to base" means
// making the base scenario's rows equal S's:
//
//   - entity/account flow overrides + gift_series: replace base's set with copies
//     of S's rows (delete base rows, then copy S's rows re-scoped to base).
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
import type { PromoteTx } from "./promote-table-registry";

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

/** Replace the base scenario's gift_series rows with copies of the promoted
 *  scenario's rows (gift_series is a per-scenario independent table). */
export async function copyGiftSeriesToBase(
  tx: PromoteTx,
  ctx: CopyCtx,
): Promise<void> {
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
