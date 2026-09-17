import { auth } from "@clerk/nextjs/server";

export type SubscriptionState =
  | { kind: "founder" }
  | { kind: "trialing"; trialEndsAt: Date }
  | { kind: "active" }
  | { kind: "active_canceling"; periodEnd: Date }
  | { kind: "past_due"; pastDueSince: Date | null }
  | { kind: "unpaid" }
  | { kind: "paused" }
  | { kind: "canceled_grace"; archivedAt: Date; mutationsAllowed: false }
  | { kind: "canceled_locked" }
  /**
   * An ops-ended Founder comp. Deliberately NOT `missing`: `missing` means
   * unprovisioned/broken, where checkout is the wrong remedy and a Subscribe
   * button could mint a duplicate subscription for a firm whose metadata
   * merely failed to write. This firm is fine — it just has to start paying.
   */
  | { kind: "comp_ended" }
  | { kind: "missing"; reason: "no_metadata" };

export const GRACE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The `subscription_status` an ops-ended comp writes into Clerk. Ours, not
 * Stripe's. Lives here, beside the `stateFromMeta` branch that READS it, so
 * the writer (`endFounderComp`) and the reader cannot drift — as bare literals
 * on both sides, a typo in either would silently drop a de-comped firm into
 * `missing` and lock it out of reads.
 */
export const COMP_ENDED_STATUS = "comp_ended";

export type OrgMeta = {
  is_founder?: boolean;
  subscription_status?: string;
  trial_ends_at?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  archived_at?: string;
  entitlements?: string[];
};

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Project Clerk org public metadata into one of the banner/access states.
 * Pure: no DB, no Clerk API, no `auth()` call — takes the already-read meta.
 * Shared by `getSubscriptionState` (server components) and `src/proxy.ts`
 * (middleware hot path), so both branch on identical logic.
 *
 * `incomplete_expired` is treated exactly like `canceled` (a sub that never
 * activated and is dead). `unpaid` and `paused` are terminal → caller locks.
 * `comp_ended` is ours, not Stripe's — written only by the ops de-comp action.
 */
export function stateFromMeta(meta: OrgMeta | undefined): SubscriptionState {
  if (!meta || Object.keys(meta).length === 0) {
    return { kind: "missing", reason: "no_metadata" };
  }
  if (meta.is_founder === true) return { kind: "founder" };

  const status = meta.subscription_status;
  // Checked before every Stripe status, but AFTER is_founder — re-comping a
  // firm must beat a stale comp_ended stamp. Nothing else writes this value;
  // a real checkout overwrites it with the live Stripe status, so the state
  // self-heals the moment they pay.
  if (status === COMP_ENDED_STATUS) return { kind: "comp_ended" };
  if (status === "trialing") {
    const trialEndsAt = parseDate(meta.trial_ends_at);
    if (trialEndsAt) {
      return { kind: "trialing", trialEndsAt };
    }
  }
  if (status === "active") {
    if (meta.cancel_at_period_end === true) {
      const periodEnd = parseDate(meta.current_period_end);
      if (periodEnd) {
        return { kind: "active_canceling", periodEnd };
      }
    }
    return { kind: "active" };
  }
  if (status === "past_due") {
    return { kind: "past_due", pastDueSince: parseDate(meta.current_period_end) };
  }
  if (status === "unpaid") return { kind: "unpaid" };
  if (status === "paused") return { kind: "paused" };
  if (status === "canceled" || status === "incomplete_expired") {
    const archivedAt = parseDate(meta.archived_at);
    if (archivedAt) {
      const ageMs = Date.now() - archivedAt.getTime();
      // Half-open window: [0d, 30d) is grace, day 30 onward is locked.
      if (ageMs >= 0 && ageMs < GRACE_WINDOW_MS) {
        return { kind: "canceled_grace", archivedAt, mutationsAllowed: false };
      }
    }
    return { kind: "canceled_locked" };
  }
  return { kind: "missing", reason: "no_metadata" };
}

/**
 * Read Clerk org public metadata via sessionClaims and project it into a
 * SubscriptionState. Thin wrapper over the pure `stateFromMeta` so server
 * components and middleware share one mapping.
 */
export async function getSubscriptionState(): Promise<SubscriptionState> {
  const { sessionClaims } = await auth();
  const meta =
    (sessionClaims as { org_public_metadata?: OrgMeta } | null)
      ?.org_public_metadata;
  return stateFromMeta(meta);
}
