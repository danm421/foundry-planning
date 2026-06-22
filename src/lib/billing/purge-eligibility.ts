export type PurgeEligibilityInput = {
  archivedAt: Date | null;
  purgedAt: Date | null;
  dataRetentionUntil: Date | null;
  /** Count of subscription rows in a LIVE status for this firm. */
  liveSubCount: number;
};

/**
 * Pure decision: may this firm be permanently purged right now?
 *
 * ALL must hold: it was archived (cancellation stamped), the retention window
 * has elapsed, it hasn't already been purged, AND it has NO live subscription
 * (a cancel-then-resubscribe firm is a paying customer — never purge it).
 *
 * The live-sub clause is the data-loss guard: archivedAt is cleared on
 * reactivation (Task 3), but this predicate is the belt-and-suspenders that
 * makes a single stale timestamp non-catastrophic.
 */
export function isFirmPurgeable(input: PurgeEligibilityInput, now: Date): boolean {
  if (input.liveSubCount > 0) return false;
  if (input.archivedAt === null) return false;
  if (input.purgedAt !== null) return false;
  if (input.dataRetentionUntil === null) return false;
  return input.dataRetentionUntil.getTime() < now.getTime();
}
