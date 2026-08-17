import { type MonthlyBar, monthlyReturns } from "@/lib/cma-stats";

/**
 * Whether a fetched price series is safe to STORE.
 *
 * Every gate here exists for one reason: `alignToCommonWindow` intersects dates
 * across every covered holding on both sides of a proposal, so a single bad
 * series does not merely describe itself badly — it reshapes the window for the
 * whole portfolio. Storing nothing leaves a holding uncovered and honestly
 * named in `uncoveredTickers`; storing a bad series is actively destructive.
 *
 * Shared by the one-off backfill script and the monthly refresh cron so the two
 * cannot drift into disagreeing about what is safe to write.
 */

/** Sourced from `MIN_MONTHS` in `lib/ticker-portfolio-service.ts`, and measured
 *  in RETURNS (bars − 1), which is what the app's threshold actually counts. */
export const MIN_RETURNS = 36;

/** `monthlyReturns` pairs ADJACENT bars regardless of the gap between them, so a
 *  series that skips 2025-09 → 2026-04 reports a seven-month move as one month's
 *  return — a plausible number that is simply false. */
export const MIN_DENSITY = 0.95;

/** A short series truncates the shared window's START; a stale one truncates its
 *  END. Three months of tolerance, not zero, because a live security is
 *  routinely a month or two behind in the feed. Beyond that the ticker is
 *  delisted, renamed, or its feed is broken. */
export const MAX_STALE_MONTHS = 3;

export type SeriesVerdict =
  | { ok: true; firstMonth: string; lastMonth: string; returns: number }
  | { ok: false; reason: string; stale?: boolean };

/** Inclusive month count between two `YYYY-MM` keys. */
export function monthSpan(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

/** `YYYY-MM` of the month before `now` — the latest closed month. */
export function priorMonthKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Judge a fetched series against all three gates.
 * `priorMonth` is the latest closed month (`YYYY-MM`), i.e. `priorMonthKey(now)`.
 */
export function assessPriceSeries(bars: readonly MonthlyBar[], priorMonth: string): SeriesVerdict {
  const returns = monthlyReturns([...bars]);
  if (returns.length < MIN_RETURNS) {
    return {
      ok: false,
      reason: `only ${returns.length} monthly returns (needs ${MIN_RETURNS}) — would collapse the shared window`,
    };
  }

  const first = returns[0].date;
  const last = returns[returns.length - 1].date;

  const span = monthSpan(first, last);
  const density = returns.length / span;
  if (density < MIN_DENSITY) {
    return {
      ok: false,
      reason: `gappy series — ${returns.length} returns across ${span} months (${(density * 100).toFixed(0)}% dense)`,
    };
  }

  // Negative when the series carries the in-progress current month, which is
  // ahead of `priorMonth` rather than behind it — not a staleness failure.
  const monthsStale = monthSpan(last, priorMonth) - 1;
  if (monthsStale > MAX_STALE_MONTHS) {
    return {
      ok: false,
      stale: true,
      reason: `stale — series ends ${last}, ${monthsStale} months behind ${priorMonth}; would truncate the shared window's END`,
    };
  }

  return { ok: true, firstMonth: first, lastMonth: last, returns: returns.length };
}
