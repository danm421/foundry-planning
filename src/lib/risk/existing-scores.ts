// src/lib/risk/existing-scores.ts
//
// Shared score lookup for both RTQ write paths (the advisor route and the
// public link route, Task 14) -- one function so the eventual fix to the
// KNOWN LIMITATION below is a one-line change in one place, not two
// diverging routes.
import { and, desc, eq } from "drizzle-orm";
import { clientRiskProfiles, riskQuestionnaires } from "@/db/schema";
import type { Tx } from "@/lib/imports/commit/types";

/**
 * The existing primary/spouse tolerance scores an incoming RTQ sitting needs
 * in order to reconcile household tolerance (`applyRtqPatch`). Must run
 * inside the same transaction as the questionnaire write and the profile
 * recompute it feeds -- see Task 14 ruling 2.
 *
 * The profile select takes `.for("update")` -- this is load-bearing, not
 * incidental. It is the FIRST lock taken in the RTQ write transaction, before
 * the questionnaire row is written, so two concurrent submissions for the
 * same client serialize here instead of each reading a stale pre-write
 * snapshot and both computing a stale "lower of the two". `recomputeProfileTx`
 * takes the same lock again later in the same transaction; by then it is a
 * harmless no-op re-lock.
 *
 * KNOWN LIMITATION (originally Task 11, controller finding F): when
 * `subject === "spouse"` and no applied `primary` questionnaire row exists,
 * `existingPrimaryScore` falls back to `client_risk_profiles.tolerance_score`
 * -- which is already the reconciled minimum once a spouse score exists.
 * Repeated spouse sittings on a backfilled household can then only ratchet
 * tolerance down. No available fix is correct without a schema change:
 * `tolerance_score` holds the reconciled value and `spouse_tolerance_score`
 * holds the spouse's raw score, but no column holds the primary's own raw
 * score (schema.ts, `client_risk_profiles.tolerance_score` /
 * `.spouse_tolerance_score`), so the primary's original score is genuinely
 * unrecoverable once reconciliation has overwritten it. This function is now
 * the single change-point for that fix once a column exists to hold it
 * (Task 14 ruling 1, user ruling 2026-07-28 -- behaviour deliberately
 * unchanged here, extraction only).
 */
export async function loadExistingScores(
  tx: Tx,
  args: { clientId: string; firmId: string; subject: "primary" | "spouse" },
): Promise<{ existingPrimaryScore: number | null; existingSpouseScore: number | null }> {
  const [profile] = await tx
    .select({
      toleranceScore: clientRiskProfiles.toleranceScore,
      spouseToleranceScore: clientRiskProfiles.spouseToleranceScore,
    })
    .from(clientRiskProfiles)
    .where(
      and(
        eq(clientRiskProfiles.clientId, args.clientId),
        eq(clientRiskProfiles.firmId, args.firmId),
      ),
    )
    .for("update");

  // client_risk_profiles.spouse_tolerance_score is always the spouse's own
  // raw score (applyRtqPatch never reconciles it), so it is safe to read
  // straight off the profile row for the primary-submission path.
  const existingSpouseScore: number | null = profile?.spouseToleranceScore ?? null;
  let existingPrimaryScore: number | null = null;

  if (args.subject === "spouse") {
    const [lastPrimary] = await tx
      .select({ score: riskQuestionnaires.score })
      .from(riskQuestionnaires)
      .where(
        and(
          eq(riskQuestionnaires.clientId, args.clientId),
          eq(riskQuestionnaires.firmId, args.firmId),
          eq(riskQuestionnaires.subject, "primary"),
          eq(riskQuestionnaires.status, "applied"),
        ),
      )
      .orderBy(desc(riskQuestionnaires.appliedAt))
      .limit(1);
    existingPrimaryScore = lastPrimary?.score ?? profile?.toleranceScore ?? null;
  }

  return { existingPrimaryScore, existingSpouseScore };
}
