// Which loan the comparison acts on, and when the plan says it is gone.

import type { ClientData, Liability } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
// A ZERO-import leaf, like `@/engine/ownership` — nothing of the projection
// follows it into the browser bundle the registry reaches this module from.
// NOT `isPaydownEligible` from `@/lib/solver/debt-paydown`, which is the same
// two-line test but value-imports the engine's schedule builder.
import { isHeldFlatLiability } from "@/engine/liability-kind";

/**
 * Loans an extra payment can actually reach: amortizing, with a balance left.
 * Held-flat debt (a credit card, or any liability with no term — an unlinked
 * Plaid loan, say) has no schedule, so an extra payment against it is silently
 * discarded and the two arms of this page would be identical.
 */
export function eligibleLoans(data: ClientData): Liability[] {
  return (data.liabilities ?? []).filter((l) => !isHeldFlatLiability(l) && l.balance > 0);
}

/** The advisor's pick, or the largest eligible balance. A pick that has since
 *  been deleted falls back rather than blanking the sheet. */
export function targetLoan(data: ClientData, liabilityId: string | null): Liability | null {
  const loans = eligibleLoans(data);
  if (loans.length === 0) return null;
  const picked = liabilityId != null ? loans.find((l) => l.id === liabilityId) : undefined;
  return picked ?? loans.reduce((best, l) => (l.balance > best.balance ? l : best));
}

/**
 * The year the loan is gone: one past the last year the projection still opens
 * with a balance on it.
 *
 * Read off the PROJECTION rather than re-amortized here. It is the engine's own
 * answer — the same schedule that caps every extra payment at the remaining
 * balance — and it keeps this module free of engine value imports.
 */
export function payoffYear(projection: ProjectionResult, liabilityId: string): number | null {
  const owing = projection.years.filter((y) => (y.liabilityBalancesBoY[liabilityId] ?? 0) > 0);
  if (owing.length === 0) return null;
  return owing[owing.length - 1].year + 1;
}
