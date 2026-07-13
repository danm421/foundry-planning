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
 * extraction omitted them. Exception: a row linked to a seeded `isDefault`
 * living slot (Current/Retirement) fills amount/growthRate but keeps its
 * canonical year window — timing is never replaced for those rows.
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

  for (const row of payload.expenses) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
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

  return result;
}
