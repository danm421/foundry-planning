import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { advisorOnboarding, clients, crmHouseholds } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { visibleHouseholdConditions } from "@/lib/home/scope";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { deriveStepStatuses } from "./step-status";
import { STEPS } from "./steps";
import type { OnboardingState } from "./types";

export type FirstRunCard =
  | { kind: "hidden" }
  | { kind: "no_client" }
  | {
      kind: "in_progress";
      clientId: string;
      householdName: string;
      completedSteps: number;
      totalSteps: number;
    }
  | { kind: "done"; clientId: string };

export interface FirstRunInput {
  eligible: boolean;
  dismissedAt: Date | null;
  client: {
    id: string;
    householdName: string;
    onboardingCompletedAt: Date | null;
    completedSteps: number;
  } | null;
  totalSteps: number;
}

/** Pure state derivation. Visibility is `eligible && !dismissed` — nothing
 *  else. Content then follows the client's wizard progress. Deriving
 *  visibility from completion too would make the "done" state unreachable:
 *  finishing the wizard redirects to the solver, not to /home. */
export function deriveFirstRunCard(input: FirstRunInput): FirstRunCard {
  if (!input.eligible || input.dismissedAt !== null) return { kind: "hidden" };
  if (!input.client) return { kind: "no_client" };
  if (input.client.onboardingCompletedAt !== null) {
    return { kind: "done", clientId: input.client.id };
  }
  return {
    kind: "in_progress",
    clientId: input.client.id,
    householdName: input.client.householdName,
    completedSteps: input.client.completedSteps,
    totalSteps: input.totalSteps,
  };
}

/** Lazily creates the row on first sight, SELECT-first so every render after
 *  the advisor's very first one is a single read with no write and no audit.
 *  On a miss, `onConflictDoNothing` keeps two concurrent first renders
 *  race-safe: only one INSERT can win the `(firmId, advisorUserId)` unique
 *  index, and `.returning()` tells this call whether it was the winner —
 *  the loser falls back to reading the winner's row (and its `eligible`)
 *  rather than overwriting it. Only the winner audits the creation, so the
 *  row is created — and audited — exactly once per advisor. */
async function ensureRow(
  firmId: string,
  advisorUserId: string,
  eligible: boolean,
) {
  const existing = await db.query.advisorOnboarding.findFirst({
    where: and(
      eq(advisorOnboarding.firmId, firmId),
      eq(advisorOnboarding.advisorUserId, advisorUserId),
    ),
  });
  if (existing) return existing;

  const [inserted] = await db
    .insert(advisorOnboarding)
    .values({ firmId, advisorUserId, eligible })
    .onConflictDoNothing({
      target: [advisorOnboarding.firmId, advisorOnboarding.advisorUserId],
    })
    .returning();

  if (inserted) {
    // recordAudit swallows its own failures (see src/lib/audit.ts), so a
    // broken audit write can't blank this /home render.
    await recordAudit({
      action: "advisor_onboarding.create",
      resourceType: "advisor_onboarding",
      resourceId: advisorUserId,
      firmId,
    });
    return inserted;
  }

  // Lost the race — a concurrent render already won the insert.
  const row = await db.query.advisorOnboarding.findFirst({
    where: and(
      eq(advisorOnboarding.firmId, firmId),
      eq(advisorOnboarding.advisorUserId, advisorUserId),
    ),
  });
  return row ?? null;
}

export async function resolveFirstRunCard(
  firmId: string,
  userId: string,
  orgRole: string | null | undefined,
): Promise<FirstRunCard> {
  // Same visibility source as getBookKpis (React-`cache`d, so this is free on
  // a render that already computed it). "Clients in the org" and "clients this
  // advisor can see" are different sets; the card must agree with the KPI row
  // it replaces.
  const hhConditions = await visibleHouseholdConditions(firmId, userId, orgRole);

  const [first] = await db
    .select({
      id: clients.id,
      householdName: crmHouseholds.name,
      onboardingState: clients.onboardingState,
      onboardingCompletedAt: clients.onboardingCompletedAt,
    })
    .from(clients)
    .innerJoin(crmHouseholds, eq(clients.crmHouseholdId, crmHouseholds.id))
    .where(and(...hhConditions))
    .orderBy(asc(clients.createdAt))
    .limit(1);

  const row = await ensureRow(firmId, userId, !first);
  if (!row || !row.eligible || row.dismissedAt !== null) return { kind: "hidden" };

  if (!first) {
    return deriveFirstRunCard({
      eligible: true,
      dismissedAt: null,
      client: null,
      totalSteps: STEPS.length,
    });
  }

  // Only loaded when the card will actually render for an advisor mid-setup —
  // by definition one client with a small tree, so the cost is bounded.
  let completedSteps = 0;
  if (first.onboardingCompletedAt === null) {
    const { effectiveTree } = await loadEffectiveTree(first.id, firmId, "base", {});
    const state = (first.onboardingState as OnboardingState | null) ?? {};
    completedSteps = deriveStepStatuses(effectiveTree, state).filter(
      (s) => s.kind === "complete" || s.kind === "skipped",
    ).length;
  }

  return deriveFirstRunCard({
    eligible: true,
    dismissedAt: null,
    client: {
      id: first.id,
      householdName: first.householdName,
      onboardingCompletedAt: first.onboardingCompletedAt,
      completedSteps,
    },
    totalSteps: STEPS.length,
  });
}

// Both blind UPDATEs below rely on the row already existing: the card can
// only be on screen (and so only reachable for a start/dismiss action) after
// `resolveFirstRunCard` → `ensureRow` has created it, so by the time either
// function is callable the `(firmId, advisorUserId)` row is guaranteed to be
// there. Calling either before that would silently affect 0 rows.

export async function markFirstRunStarted(
  firmId: string,
  advisorUserId: string,
): Promise<void> {
  await db
    .update(advisorOnboarding)
    .set({ startedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(advisorOnboarding.firmId, firmId),
        eq(advisorOnboarding.advisorUserId, advisorUserId),
      ),
    );
}

export async function dismissFirstRun(
  firmId: string,
  advisorUserId: string,
): Promise<void> {
  await db
    .update(advisorOnboarding)
    .set({ dismissedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(advisorOnboarding.firmId, firmId),
        eq(advisorOnboarding.advisorUserId, advisorUserId),
      ),
    );
}
