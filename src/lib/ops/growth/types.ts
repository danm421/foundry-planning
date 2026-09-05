// src/lib/ops/growth/types.ts
//
// The plain shapes the pure growth builders speak. Nothing here imports Next,
// Drizzle, Clerk or @/db — that boundary is what lets metrics/funnel/attention/
// digest be tested as ordinary functions. `load.ts` is the only module that
// knows where these values actually come from.

export type FirmInput = {
  firmId: string;
  displayName: string | null;
  isFounder: boolean;
  archivedAt: Date | null;
  createdAt: Date;
};

export type SubInput = {
  firmId: string;
  status: string;
  trialStart: Date | null;
  trialEnd: Date | null;
  canceledAt: Date | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

/** One live line on a subscription. `removedAt` non-null means it is gone. */
export type ItemInput = {
  firmId: string;
  quantity: number;
  unitAmount: number; // cents
  removedAt: Date | null;
};

/**
 * One audit_log row, already filtered by `load.ts` to actor_kind='advisor'
 * AND actor_id LIKE 'user_%'. `action` is kept because
 * `billing.access_denied` is a blocked attempt, not work.
 */
export type ActivityInput = {
  firmId: string;
  actorId: string;
  action: string;
  createdAt: Date;
};

/** One Clerk account, flattened. `firmIds` is every org they belong to. */
export type ClerkUserInput = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
  lastSignInAt: Date | null;
  hasPendingSignup: boolean;
  pendingFirmName: string | null;
  firmIds: string[];
};

export type GrowthInput = {
  firms: FirmInput[];
  subs: SubInput[];
  items: ItemInput[];
  activity: ActivityInput[];
  users: ClerkUserInput[];
  clientCountByFirm: Record<string, number>;
  now: Date;
};

export type GrowthMetrics = {
  mrrCents: number;
  trialsRunning: number;
  trialsEndingSoon: number;
  /** null when no trial has resolved yet — 0% would be a lie. */
  trialToPaidPct: number | null;
  resolvedTrials: number;
  convertedTrials: number;
  stalledAtCheckout: number;
  activeThisWeek: number;
};

export const BLOCKED_ACTION = "billing.access_denied";
export const ACTIVE_WINDOW_DAYS = 7;
export const TRIAL_TILE_HORIZON_DAYS = 7;

/** Statuses in which a firm is paying us, or is expected to. */
export const PAID_STATUSES = ["active", "past_due", "unpaid"] as const;

/** Separates a ~365-day annual billing period from a ~30-day monthly one. */
export const ANNUAL_PERIOD_THRESHOLD_DAYS = 300;

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

/**
 * The distinct advisors who did real work at or after `since`.
 *
 * Shared by the "Active this week" tile and the "signing in, building nothing"
 * worklist so the two can never disagree about what counts as work — a blocked
 * paywall attempt is a signal, never work. Only the FILTER is shared: each
 * caller still passes its own cutoff, because ACTIVE_WINDOW_DAYS and
 * attention.ts's QUIET_DAYS answer different questions and are free to diverge.
 */
export function activeActorIds(activity: ActivityInput[], since: Date): Set<string> {
  return new Set(
    activity
      .filter((a) => a.action !== BLOCKED_ACTION && a.createdAt >= since)
      .map((a) => a.actorId),
  );
}
