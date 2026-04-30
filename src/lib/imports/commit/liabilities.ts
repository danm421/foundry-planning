import { and, eq } from "drizzle-orm";

import { liabilities, liabilityOwners } from "@/db/schema";

import { getExistingId, type ImportPayload } from "../types";
import { loadFamilyRoleIds, type FamilyRoleIds } from "./family-resolver";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Commits the liabilities tab. Mirrors accounts: insert/update keyed by
 * match annotation, owners synthesized on insert from the household's
 * role='client' familyMember row (liabilities have no `owner` enum, so
 * a single 100% client owner is the only synthesis path — joint/spouse
 * variants require manual setup post-commit).
 *
 * Field map (per plan):
 *   name: keep-existing
 *   balance, interestRate, monthlyPayment: replace
 *   startYear, termMonths: replace-if-non-null
 *
 * Notes:
 *   - schema requires startYear (notNull) and termMonths (notNull); on
 *     insert we fall back to current year and a 360-month (30-year)
 *     placeholder when extraction omitted them.
 *   - liabilityOwners are NOT touched on update — advisor-managed.
 */
export async function commitLiabilities(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
  preloadedFamily?: FamilyRoleIds,
): Promise<CommitResult> {
  const result = emptyResult();
  const family = preloadedFamily ?? (await loadFamilyRoleIds(tx, ctx.clientId));
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  for (const row of payload.liabilities) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    if (kind === "new") {
      const [inserted] = await tx
        .insert(liabilities)
        .values({
          clientId: ctx.clientId,
          scenarioId: ctx.scenarioId,
          name: row.name,
          balance: row.balance != null ? String(row.balance) : "0",
          interestRate: row.interestRate != null ? String(row.interestRate) : "0",
          monthlyPayment:
            row.monthlyPayment != null ? String(row.monthlyPayment) : "0",
          startYear: row.startYear ?? currentYear,
          termMonths: 360,
        })
        .returning({ id: liabilities.id });

      if (family.clientFmId) {
        await tx.insert(liabilityOwners).values({
          liabilityId: inserted.id,
          familyMemberId: family.clientFmId,
          entityId: null,
          percent: "1.0000",
        });
      }
      result.created += 1;
      continue;
    }

    const existingId = getExistingId(row);
    if (!existingId) {
      result.skipped += 1;
      continue;
    }
    const updates: Record<string, unknown> = { updatedAt: now };
    if (row.balance !== undefined) updates.balance = String(row.balance);
    if (row.interestRate !== undefined) {
      updates.interestRate = String(row.interestRate);
    }
    if (row.monthlyPayment !== undefined) {
      updates.monthlyPayment = String(row.monthlyPayment);
    }
    if (row.startYear != null) updates.startYear = row.startYear;
    await tx
      .update(liabilities)
      .set(updates)
      .where(
        and(
          eq(liabilities.id, existingId),
          eq(liabilities.clientId, ctx.clientId),
          eq(liabilities.scenarioId, ctx.scenarioId),
        ),
      );
    result.updated += 1;
  }

  return result;
}
