import { and, eq } from "drizzle-orm";

import { expenses } from "@/db/schema";

import { getExistingId, type ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";
import { resolveImportTiming } from "./timing";

/**
 * Commits the expenses tab. Mirrors incomes — type/name preserved on
 * update, annualAmount always replaces, year/growthRate fields use
 * replace-if-non-null. Schema requires startYear/endYear so we fall back
 * to a sensible default range (current year → +30) on insert when
 * extraction omitted them. Exception: a NON-living row the advisor linked to a
 * seeded `isDefault` living slot (Current/Retirement) fills amount/growthRate
 * but keeps the slot's canonical year window — timing is never replaced there.
 *
 * THE LIVING-EXPENSE FOLD IS UNCONDITIONAL. `type: "living"` is a CLOSED SET of
 * exactly two rows per (client, scenario) — a Current row and a Retirement row,
 * both seeded and `isDefault` (see `lib/living-expenses.ts`). So this module
 * never writes a living row at all, in either direction:
 *
 *   - it never INSERTS one, because a third living row cannot exist. Writing
 *     the itemized detail alongside the reviewed total is what double-counted
 *     spending in the first place (Housing 24k + Groceries 12k + Utilities 6k
 *     landed as 42k on the slot AND 42k of new rows), and it double-counted
 *     retirement spending too, because an inserted row's default
 *     `currentYear + 30` end year runs straight through retirement.
 *
 *   - it never UPDATES one either, because `commitPlanBasics` is the SINGLE
 *     writer of the two slots' amounts. `sumExtractedLivingByRole` has already
 *     banked every extracted living row into the Current or the Retirement
 *     bucket, and `commitPlanBasics` writes those two bucket totals. A row that
 *     also stamped its own amount onto a slot here would race that write — the
 *     review wizard commits ONE TAB PER CLICK, IN EITHER ORDER — and the loser's
 *     money would be silently gone. A three-row document ("Living Expenses"
 *     100k, "Retirement Living Expenses" 40k, "Retirement Spending Need" 20k)
 *     did exactly that: the retirement bucket totals 60k, but the linked 40k
 *     row used to overwrite it, deleting the unlinked row's 20k outright.
 *
 * Folded rows are counted as `skipped`, the same channel the deliberately-
 * not-written fuzzy rows use: this is a decision, not a failure, and the
 * warning at the end of this function discloses it.
 */
export async function commitExpenses(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  // Seeded isDefault living slots (Current/Retirement). A NON-living row the
  // advisor linked to one of these gets its amount filled but keeps the slot's
  // canonical year window — timing is never reshaped by extracted timing.
  const slotRows = await tx
    .select({ id: expenses.id })
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

  let folded = 0;

  for (const row of payload.expenses) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    // THE CLOSED SET. A `type: "living"` row is either linked to one of the two
    // seeded slots — in which case `commitPlanBasics` writes the reviewed
    // bucket total onto it — or it is itemized detail that has been folded into
    // that total by `sumExtractedLivingByRole`. Either way it is never written
    // here, on EITHER branch below: not inserted as a third living row, and not
    // updated onto a slot whose only writer is `commitPlanBasics`.
    if (row.type === "living") {
      result.skipped += 1;
      folded += 1;
      continue;
    }

    if (kind === "new") {
      const timing = resolveImportTiming(row, ctx.milestones);
      await tx.insert(expenses).values({
        clientId: ctx.clientId,
        scenarioId: ctx.scenarioId,
        // No extracted type means "some expense we can't classify" — that is
        // `other`. It can no longer default to living: living is a closed set.
        type: row.type ?? "other",
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
        `totalled into the Current and Retirement living-expense rows on Plan basics ` +
        `and not written as separate expense rows.`,
    );
  }

  return result;
}
