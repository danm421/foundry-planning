import { and, eq } from "drizzle-orm";

import { incomes } from "@/db/schema";

import { getExistingId, type ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Commits the incomes tab.
 *
 * Field map:
 *   type, name: keep-existing on update; replace on create
 *   annualAmount: replace
 *   startYear, endYear, owner, growthRate: replace-if-non-null
 *
 * Notes:
 *   - The schema requires startYear / endYear (notNull). On insert we fall
 *     back to a wide window (current calendar year → +30) when the
 *     extraction omitted them; advisors can refine in the wizard.
 *   - growthRate has a notNull schema default of 0.03 — we only override
 *     when extraction provides a value.
 */
export async function commitIncomes(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  for (const row of payload.incomes) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    if (kind === "new") {
      await tx.insert(incomes).values({
        clientId: ctx.clientId,
        scenarioId: ctx.scenarioId,
        type: row.type ?? "other",
        name: row.name,
        annualAmount: row.annualAmount != null ? String(row.annualAmount) : "0",
        startYear: row.startYear ?? currentYear,
        endYear: row.endYear ?? currentYear + 30,
        growthRate: row.growthRate != null ? String(row.growthRate) : "0.03",
        owner: row.owner ?? "client",
        source: "extracted",
      });
      result.created += 1;
      continue;
    }

    // exact — preserve type/name; replace annualAmount; replace-if-non-null on the rest
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
    if (row.owner != null) updates.owner = row.owner;
    if (row.growthRate != null) updates.growthRate = String(row.growthRate);
    await tx
      .update(incomes)
      .set(updates)
      .where(
        and(
          eq(incomes.id, existingId),
          eq(incomes.clientId, ctx.clientId),
          eq(incomes.scenarioId, ctx.scenarioId),
        ),
      );
    result.updated += 1;
  }

  return result;
}
