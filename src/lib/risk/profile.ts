//
// The sole writer of composite_score, composite_level, and binding_constraint.
// Every path that changes a risk input -- RTQ, manual rung, environment,
// capacity recompute -- goes through recomputeProfile so the denormalized
// composite can never drift from its inputs.
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { clientRiskProfiles, clientRiskProfileEvents } from "@/db/schema";
import type { ClientRiskProfileRow } from "@/db/schema";
import type { Tx } from "@/lib/imports/commit/types";
import { computeProfile } from "./scoring";

export type RiskProfileEventKind =
  | "profile_created"
  | "rtq_completed"
  | "tolerance_manual"
  | "environment_changed"
  | "capacity_changed";

export type ProfilePatch = Partial<
  Pick<
    ClientRiskProfileRow,
    | "toleranceScore"
    | "toleranceSource"
    | "toleranceConfirmedAt"
    | "rtqVersion"
    | "spouseToleranceScore"
    | "spouseRtqVersion"
    | "capacityScore"
    | "capacityFactors"
    | "capacityComputedAt"
    | "requiredGrowthPct"
    | "environmentAdj"
    | "environmentReason"
    | "environmentUpdatedAt"
  >
>;

export interface RecomputeArgs {
  clientId: string;
  firmId: string;
  /** Null for client-submitted or system-generated changes. */
  actorUserId: string | null;
  kind: RiskProfileEventKind;
  reason: string | null;
  patch: ProfilePatch;
}

/**
 * Capacity drift is continuous -- a plan edit moves it by a point or two
 * constantly. Logging every move makes the history unreadable within a month,
 * so a capacity recompute only earns a row when it actually moved the household
 * to a different rung. Advisor-driven changes always log: the reasoning is the
 * point of the record.
 */
function shouldLogEvent(
  kind: RiskProfileEventKind,
  beforeLevel: string | null,
  afterLevel: string | null,
): boolean {
  if (kind !== "capacity_changed") return true;
  return beforeLevel !== afterLevel;
}

/**
 * The transaction body of `recomputeProfile`, exposed so a caller that must
 * fold the write into a larger transaction (Task 14 ruling 2: the RTQ
 * routes' score lookup, questionnaire write, and this recompute all need to
 * commit or fail together) can pass its own `tx` in rather than opening a
 * second, nested transaction. `recomputeProfile` below is the byte-for-byte
 * unchanged top-level entry point every other caller keeps using.
 */
export async function recomputeProfileTx(
  tx: Tx,
  args: RecomputeArgs,
): Promise<ClientRiskProfileRow> {
  // The read, the insert-vs-update branch it drives, and the event's
  // before/after snapshot must all see the same row. `.for("update")`
  // locks it for the rest of this transaction so a concurrent
  // recomputeProfile call for the same client (e.g. the capacity cron
  // racing an advisor's environment-adjustment route) blocks here instead
  // of reading the same stale snapshot and each writing a composite that
  // only reflects its own change -- same pattern as ownership.ts
  // (_applyToAccount/_applyToLiability) and portal/vault-folders.ts.
  //
  // When a caller (the RTQ routes) has already taken this same lock via
  // `loadExistingScores` earlier in the transaction, this `.for("update")`
  // is a harmless no-op re-lock, not a second, redundant lock -- it must
  // stay so `recomputeProfileTx` is still safe to call on its own.
  const [existing] = await tx
    .select()
    .from(clientRiskProfiles)
    .where(
      and(
        eq(clientRiskProfiles.clientId, args.clientId),
        eq(clientRiskProfiles.firmId, args.firmId),
      ),
    )
    .for("update");

  const merged = {
    toleranceScore: existing?.toleranceScore ?? null,
    capacityScore: existing?.capacityScore ?? null,
    environmentAdj: existing?.environmentAdj ?? 0,
    ...args.patch,
  };

  const result = computeProfile({
    toleranceScore: merged.toleranceScore ?? null,
    capacityScore: merged.capacityScore ?? null,
    environmentAdj: merged.environmentAdj ?? 0,
  });

  const beforeScore = existing?.compositeScore ?? null;
  const beforeLevel = existing?.compositeLevel ?? null;

  const values = {
    ...args.patch,
    compositeScore: result.compositeScore,
    compositeLevel: result.compositeLevel,
    bindingConstraint: result.bindingConstraint,
    updatedAt: new Date(),
  };

  let row: ClientRiskProfileRow;
  if (existing) {
    const [updated] = await tx
      .update(clientRiskProfiles)
      .set(values)
      .where(eq(clientRiskProfiles.id, existing.id))
      .returning();
    row = updated;
  } else {
    // `.for("update")` locks nothing when the SELECT above matched zero
    // rows, so two concurrent first-writes for the same client can both
    // reach this branch. onConflictDoUpdate against the table's own
    // client_risk_profiles_client_idx unique index (clientId) makes the
    // second writer converge onto the first writer's row instead of
    // dying on a unique-constraint violation.
    const [created] = await tx
      .insert(clientRiskProfiles)
      .values({ clientId: args.clientId, firmId: args.firmId, ...values })
      .onConflictDoUpdate({
        target: clientRiskProfiles.clientId,
        set: values,
      })
      .returning();
    row = created;
  }

  if (shouldLogEvent(args.kind, beforeLevel, result.compositeLevel)) {
    await tx.insert(clientRiskProfileEvents).values({
      firmId: args.firmId,
      clientId: args.clientId,
      kind: args.kind,
      actorUserId: args.actorUserId,
      reason: args.reason,
      beforeScore,
      beforeLevel,
      afterScore: result.compositeScore,
      afterLevel: result.compositeLevel,
      components: {
        tolerance: merged.toleranceScore ?? null,
        capacity: merged.capacityScore ?? null,
        environmentAdj: merged.environmentAdj ?? 0,
      },
    });
  }

  return row;
}

export async function recomputeProfile(
  args: RecomputeArgs,
): Promise<ClientRiskProfileRow> {
  return db.transaction((tx) => recomputeProfileTx(tx, args));
}

/**
 * Create an empty profile row if none exists. Used before the first RTQ.
 *
 * Callers (Tasks 10-14) call this on every entry to the risk flow, so a
 * profile usually already exists. Short-circuit on that case: routing an
 * existing profile through recomputeProfile would still log a
 * "profile_created" event under the always-log rule for that kind, even
 * though nothing changed (beforeScore === afterScore, beforeLevel ===
 * afterLevel) -- a no-op entry in what the schema calls the suitability
 * audit trail.
 */
export async function ensureProfile(
  clientId: string,
  firmId: string,
  actorUserId: string | null,
): Promise<ClientRiskProfileRow> {
  const existing = await db.query.clientRiskProfiles.findFirst({
    where: and(
      eq(clientRiskProfiles.clientId, clientId),
      eq(clientRiskProfiles.firmId, firmId),
    ),
  });
  if (existing) return existing;

  return recomputeProfile({
    clientId,
    firmId,
    actorUserId,
    kind: "profile_created",
    reason: null,
    patch: {},
  });
}
