/**
 * Trim a per-year need series to the span that actually carries a need — the
 * first year with a positive client OR spouse need through the last such year,
 * dropping the flat $0 runs before and after. Returns [] when no year ever has
 * a need (callers render an empty state).
 *
 * Framework-free and generic over any row exposing the two need fields, so the
 * live-solver need-over-time chart and the presentation summary chart share one
 * implementation instead of forking it. Deliberately dependency-free (no engine
 * imports) so it's safe to pull into the client bundle.
 */
export function clipToNeedWindow<
  T extends { clientNeed: number; spouseNeed: number | null },
>(rows: T[]): T[] {
  const hasNeed = (r: T) => r.clientNeed > 0 || (r.spouseNeed ?? 0) > 0;
  const first = rows.findIndex(hasNeed);
  if (first === -1) return [];
  const last = rows.findLastIndex(hasNeed);
  return rows.slice(first, last + 1);
}
