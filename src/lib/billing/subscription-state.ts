import { auth } from "@clerk/nextjs/server";

export type SubscriptionState =
  | { kind: "founder" }
  | { kind: "trialing"; trialEndsAt: Date }
  | { kind: "active" }
  | { kind: "active_canceling"; periodEnd: Date }
  | { kind: "past_due" }
  | { kind: "canceled_grace"; archivedAt: Date; mutationsAllowed: false }
  | { kind: "canceled_locked" }
  | { kind: "missing"; reason: "no_metadata" };

const GRACE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type OrgMeta = {
  is_founder?: boolean;
  subscription_status?: string;
  trial_ends_at?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  archived_at?: string;
};

/**
 * Read Clerk org public metadata via sessionClaims and project it into
 * one of the seven banner states (or `missing` if metadata is absent).
 *
 * Pure: no DB, no extra Clerk API call. Intended for both the
 * <SubscriptionGuard> banner and any future server logic that needs to
 * branch on subscription state without Stripe.
 */
export async function getSubscriptionState(): Promise<SubscriptionState> {
  const { sessionClaims } = await auth();
  const meta =
    (sessionClaims as { org_public_metadata?: OrgMeta } | null)
      ?.org_public_metadata;
  if (!meta || Object.keys(meta).length === 0) {
    return { kind: "missing", reason: "no_metadata" };
  }
  if (meta.is_founder === true) return { kind: "founder" };

  const status = meta.subscription_status;
  if (status === "trialing" && meta.trial_ends_at) {
    return { kind: "trialing", trialEndsAt: new Date(meta.trial_ends_at) };
  }
  if (status === "active") {
    if (meta.cancel_at_period_end === true && meta.current_period_end) {
      return {
        kind: "active_canceling",
        periodEnd: new Date(meta.current_period_end),
      };
    }
    return { kind: "active" };
  }
  if (status === "past_due") return { kind: "past_due" };
  if (status === "canceled") {
    if (meta.archived_at) {
      const archivedAt = new Date(meta.archived_at);
      const ageMs = Date.now() - archivedAt.getTime();
      if (ageMs < GRACE_WINDOW_MS) {
        return { kind: "canceled_grace", archivedAt, mutationsAllowed: false };
      }
    }
    return { kind: "canceled_locked" };
  }
  return { kind: "missing", reason: "no_metadata" };
}
