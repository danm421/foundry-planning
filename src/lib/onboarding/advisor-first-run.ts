import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { advisorOnboarding, clients, crmHouseholds } from "@/db/schema";
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

/** Lazily creates the row on first sight. `onConflictDoNothing` makes this
 *  race-safe: two concurrent first renders cannot produce two rows, and the
 *  loser reads the winner's `eligible` rather than overwriting it. */
async function ensureRow(
  firmId: string,
  advisorUserId: string,
  eligible: boolean,
) {
  await db
    .insert(advisorOnboarding)
    .values({ firmId, advisorUserId, eligible })
    .onConflictDoNothing({
      target: [advisorOnboarding.firmId, advisorOnboarding.advisorUserId],
    });
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
