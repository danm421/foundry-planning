//
// The sole writer of composite_score, composite_level, and binding_constraint.
// Every path that changes a risk input -- RTQ, manual rung, environment,
// capacity recompute -- goes through recomputeProfile so the denormalized
// composite can never drift from its inputs.
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { clientRiskProfiles, clientRiskProfileEvents } from "@/db/schema";
import type { ClientRiskProfileRow } from "@/db/schema";
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

export async function recomputeProfile(
  args: RecomputeArgs,
): Promise<ClientRiskProfileRow> {
  const existing = await db.query.clientRiskProfiles.findFirst({
    where: and(
      eq(clientRiskProfiles.clientId, args.clientId),
      eq(clientRiskProfiles.firmId, args.firmId),
    ),
  });

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

  return db.transaction(async (tx) => {
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
      const [created] = await tx
        .insert(clientRiskProfiles)
        .values({ clientId: args.clientId, firmId: args.firmId, ...values })
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
  });
}

/** Create an empty profile row if none exists. Used before the first RTQ. */
export async function ensureProfile(
  clientId: string,
  firmId: string,
  actorUserId: string | null,
): Promise<ClientRiskProfileRow> {
  return recomputeProfile({
    clientId,
    firmId,
    actorUserId,
    kind: "profile_created",
    reason: null,
    patch: {},
  });
}
