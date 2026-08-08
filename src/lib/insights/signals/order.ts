import type { Signal, SignalSeverity } from "./types";

/** Triage order. Lower sorts first. */
const SEVERITY_RANK: Record<SignalSeverity, number> = {
  critical: 0,
  opportunity: 1,
  watch: 2,
  info: 3,
};

/**
 * Severity rank, then estimatedImpact descending, then id ascending.
 *
 * The id tiebreak is not cosmetic: `hashBattery` hashes the ordered list, so
 * two equal-impact signals swapping places would flip the staleness flag on a
 * household whose data never changed. The tiebreak is an ordinal (UTF-16
 * code-unit) comparison, not `localeCompare` — locale-aware collation
 * depends on the runtime's ICU/CLDR build, so it can reorder two identical
 * ids across a Node or platform bump even though nothing about the
 * household changed. Returns a new array.
 */
export function orderSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    // Null impact sorts last within its severity.
    const ai = a.estimatedImpact ?? Number.NEGATIVE_INFINITY;
    const bi = b.estimatedImpact ?? Number.NEGATIVE_INFINITY;
    if (ai !== bi) return bi - ai;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
