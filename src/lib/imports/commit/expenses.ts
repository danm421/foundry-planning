import { and, eq } from "drizzle-orm";

import { expenses } from "@/db/schema";
import type { YearRef } from "@/lib/milestones";

import { isSummedLivingRow, livingTotalSupersedesRows } from "../living-rows";
import { livingSlotRole } from "../match-keys/living-slot";
import { getExistingId, type ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";
import { resolveImportTiming } from "./timing";

/**
 * Commits the expenses tab. Mirrors incomes — type/name preserved on
 * update, annualAmount always replaces, year/growthRate fields use
 * replace-if-non-null. Schema requires startYear/endYear so we fall back
 * to a sensible default range (current year → +30) on insert when
 * extraction omitted them. Exception: a row linked to a seeded `isDefault`
 * living slot (Current/Retirement) fills amount/growthRate but keeps its
 * canonical year window — timing is never replaced for those rows.
 *
 * THE LIVING-EXPENSE FOLD. When the advisor has a current-living-spending
 * figure on the Plan basics step, that reviewed total supersedes the itemized
 * detail: `commitPlanBasics` writes it onto the seeded Current Living
 * Expenses slot — the engine's canonical living-expense row — and every
 * extracted row that fed the sum is skipped here instead of being written
 * separately. Writing both is what double-counted spending (Housing 24k +
 * Groceries 12k + Utilities 6k landed as 42k on the slot AND 42k of new rows),
 * and it double-counted retirement spending too, because those inserted rows
 * default to a `currentYear + 30` end year that runs straight through
 * retirement alongside the derived retirement figure on its own slot.
 *
 * Which rows fed the sum is decided by `isSummedLivingRow` — the SAME
 * predicate `sumExtractedLiving` uses to build the figure, imported rather
 * than restated, because a second copy that drifts recreates the bug.
 */
export async function commitExpenses(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  // Seeded isDefault living slots (Current/Retirement). A row linked to one of
  // these gets its amount filled but keeps its canonical current/retirement
  // year window — never reshaped by extracted timing.
  const slotRows = await tx
    .select({ id: expenses.id, startYearRef: expenses.startYearRef })
    .from(expenses)
    .where(
      and(
        eq(expenses.clientId, ctx.clientId),
        eq(expenses.scenarioId, ctx.scenarioId),
        eq(expenses.type, "living"),
        eq(expenses.isDefault, true),
      ),
    );
  const slotIds = new Set(slotRows.map((r) => r.id));

  // Fold only when the total has somewhere to land. `livingTotalSupersedesRows`
  // states an INTENT to write; `commitPlanBasics` only actually writes a slot
  // whose `startYearRef` classifies as "current", and skips any it cannot
  // place. Without this check, a household with no isDefault living slot — or
  // one whose slots predate migration 0012, which added `start_year_ref` with
  // no backfill — folds every itemized row while nothing is written to a slot,
  // and the spending disappears entirely. That is worse than double-counting,
  // so the fold is bound to the same classifier that decides the write.
  const hasCurrentSlot = slotRows.some(
    (r) => livingSlotRole((r.startYearRef ?? null) as YearRef | null) === "current",
  );

  // Same classification the assemble side uses, derived here from the slot
  // rows this module already queried. Both sides must agree on which rows fed
  // the figure, or the fold suppresses rows that were never summed.
  const retirementSlotIds: ReadonlySet<string> = new Set(
    slotRows
      .filter((r) => livingSlotRole((r.startYearRef ?? null) as YearRef | null) === "retirement")
      .map((r) => r.id),
  );

  // Blank stays blank: with no planBasics block, or a null/cleared figure,
  // nothing is written to the slot and the itemized rows must still land.
  const foldLivingRows = livingTotalSupersedesRows(payload) && hasCurrentSlot;
  let folded = 0;

  for (const row of payload.expenses) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    // Folded into the reviewed total. Counted as `skipped`, the same channel
    // the deliberately-not-written fuzzy rows use — this is a decision, not a
    // failure, and the warning below says so in the commit result.
    if (foldLivingRows && isSummedLivingRow(row, retirementSlotIds)) {
      result.skipped += 1;
      folded += 1;
      continue;
    }

    if (kind === "new") {
      const timing = resolveImportTiming(row, ctx.milestones);
      await tx.insert(expenses).values({
        clientId: ctx.clientId,
        scenarioId: ctx.scenarioId,
        type: row.type ?? "living",
        name: row.name,
        annualAmount: row.annualAmount != null ? String(row.annualAmount) : "0",
        startYear: timing.start.year ?? currentYear,
        endYear: timing.end.year ?? currentYear + 30,
        startYearRef: timing.start.ref ?? null,
        endYearRef: timing.end.ref ?? null,
        growthRate: row.growthRate != null ? String(row.growthRate) : "0.03",
        source: "extracted",
      });
      result.created += 1;
      continue;
    }

    const existingId = getExistingId(row);
    if (!existingId) {
      result.skipped += 1;
      continue;
    }
    const updates: Record<string, unknown> = { updatedAt: now };
    if (row.annualAmount !== undefined) {
      updates.annualAmount = String(row.annualAmount);
    }
    if (!slotIds.has(existingId)) {
      const timing = resolveImportTiming(row, ctx.milestones);
      if (timing.start.year !== undefined) {
        updates.startYear = timing.start.year;
        updates.startYearRef = timing.start.ref ?? null;
      }
      if (timing.end.year !== undefined) {
        updates.endYear = timing.end.year;
        updates.endYearRef = timing.end.ref ?? null;
      }
    }
    if (row.growthRate != null) updates.growthRate = String(row.growthRate);
    await tx
      .update(expenses)
      .set(updates)
      .where(
        and(
          eq(expenses.id, existingId),
          eq(expenses.clientId, ctx.clientId),
          eq(expenses.scenarioId, ctx.scenarioId),
        ),
      );
    result.updated += 1;
  }

  if (folded > 0) {
    result.warnings.push(
      `${folded} extracted living-expense ${folded === 1 ? "row was" : "rows were"} ` +
        `folded into the reviewed living-expense total on Plan basics and not written ` +
        `as separate expense rows.`,
    );
  }

  return result;
}
