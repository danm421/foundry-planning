// src/lib/ops/growth/metrics.ts
//
// The five header tiles. Pure: no DB, no Clerk, no clock — `now` arrives on
// the input so every figure is reproducible in a test.
import {
  ACTIVE_WINDOW_DAYS,
  ANNUAL_PERIOD_THRESHOLD_DAYS,
  PAID_STATUSES,
  TRIAL_TILE_HORIZON_DAYS,
  activeActorIds,
  daysBetween,
  type GrowthInput,
  type GrowthMetrics,
  type SubInput,
} from "./types";

/**
 * Annual or monthly, read off the subscription's own billing period rather
 * than the price catalog: `getPriceCatalog()` throws when any of its three env
 * vars is unset, which would take the whole dashboard down. Trials never reach
 * here (they contribute no revenue), so a 14-day span is never classified.
 */
function monthlyCents(sub: SubInput, cents: number): number {
  const { currentPeriodStart: s, currentPeriodEnd: e } = sub;
  if (!s || !e) return cents;
  return daysBetween(s, e) >= ANNUAL_PERIOD_THRESHOLD_DAYS ? Math.round(cents / 12) : cents;
}

export function buildMetrics(input: GrowthInput): GrowthMetrics {
  const { firms, subs, items, activity, users, now } = input;

  const founderFirms = new Set(firms.filter((f) => f.isFounder).map((f) => f.firmId));
  const billable = subs.filter((s) => !founderFirms.has(s.firmId));

  // --- revenue -----------------------------------------------------------
  const itemsByFirm = new Map<string, number>();
  for (const it of items) {
    if (it.removedAt) continue;
    if (founderFirms.has(it.firmId)) continue;
    itemsByFirm.set(it.firmId, (itemsByFirm.get(it.firmId) ?? 0) + it.unitAmount * it.quantity);
  }
  let mrrCents = 0;
  for (const s of billable) {
    if (s.status !== "active") continue;
    const cents = itemsByFirm.get(s.firmId);
    if (cents) mrrCents += monthlyCents(s, cents);
  }

  // --- trials ------------------------------------------------------------
  const trialsRunning = billable.filter((s) => s.status === "trialing").length;
  // `daysBetween` is signed, so a trial whose end date has already passed
  // yields a NEGATIVE number. Without the lower bound a stale `trialing` row
  // that ended 300 days ago still reads "ending this week" on the tile while
  // the worklist correctly ignores it. attention.ts carries the same guard.
  const trialsEndingSoon = billable.filter((s) => {
    if (s.status !== "trialing" || s.trialEnd == null) return false;
    const left = daysBetween(now, s.trialEnd);
    return left >= 0 && left <= TRIAL_TILE_HORIZON_DAYS;
  }).length;

  const resolved = billable.filter((s) => s.trialEnd != null && s.trialEnd <= now);
  const converted = resolved.filter(
    (s) =>
      (PAID_STATUSES as readonly string[]).includes(s.status) ||
      (s.canceledAt != null && s.trialEnd != null && s.canceledAt > s.trialEnd),
  );
  const trialToPaidPct =
    resolved.length === 0 ? null : Math.round((converted.length / resolved.length) * 100);

  // --- usage -------------------------------------------------------------
  const cutoff = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000);
  const actors = activeActorIds(activity, cutoff);

  return {
    mrrCents,
    trialsRunning,
    trialsEndingSoon,
    trialToPaidPct,
    resolvedTrials: resolved.length,
    convertedTrials: converted.length,
    stalledAtCheckout: users.filter((u) => u.hasPendingSignup && u.firmIds.length === 0).length,
    activeThisWeek: actors.size,
  };
}
