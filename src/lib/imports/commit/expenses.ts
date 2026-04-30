import { and, eq } from "drizzle-orm";

import { expenses } from "@/db/schema";

import { getExistingId, type ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Commits the expenses tab. Mirrors incomes — type/name preserved on
 * update, annualAmount always replaces, year/growthRate fields use
 * replace-if-non-null. Schema requires startYear/endYear so we fall back
 * to a sensible default range (current year → +30) on insert when
 * extraction omitted them.
 */
export async function commitExpenses(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  for (const row of payload.expenses) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    if (kind === "new") {
      await tx.insert(expenses).values({
        clientId: ctx.clientId,
        scenarioId: ctx.scenarioId,
        type: row.type ?? "living",
        name: row.name,
        annualAmount: row.annualAmount != null ? String(row.annualAmount) : "0",
        startYear: row.startYear ?? currentYear,
        endYear: row.endYear ?? currentYear + 30,
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
    if (row.startYear != null) updates.startYear = row.startYear;
    if (row.endYear != null) updates.endYear = row.endYear;
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
