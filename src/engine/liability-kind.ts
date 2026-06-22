/**
 * Liability-type discriminator for the projection engine. A "revolving"
 * liability (credit card) is NON-amortizing: the engine holds its balance flat
 * (no schedule, no payment outflow, no accrual). v1 holds only `credit_card`
 * flat; every other type — and any legacy row with `liabilityType` null —
 * amortizes as before.
 *
 * Held-flat rationale (Phase 2 spec): card SPENDING is already captured as
 * expenses, so amortizing the balance or generating a payment outflow would
 * double-count. APR / minimum-payment are display-only metadata.
 */
export type LiabilityType =
  | "mortgage"
  | "heloc"
  | "auto"
  | "student"
  | "personal"
  | "credit_card"
  | "other";

export const REVOLVING_LIABILITY_TYPES = ["credit_card"] as const;

export function isRevolvingLiability(liab: {
  liabilityType?: LiabilityType | null;
}): boolean {
  return (
    liab.liabilityType != null &&
    (REVOLVING_LIABILITY_TYPES as readonly string[]).includes(liab.liabilityType)
  );
}

/**
 * True when the engine must hold the liability's balance flat (no schedule, no
 * payment outflow, no accrual) rather than amortize it.
 *
 * Two cases:
 *  1. Revolving (credit card) — always held flat (card spending is already
 *     modeled as expenses; amortizing would double-count).
 *  2. Any liability with NO amortization term — e.g. a Plaid-synced loan, which
 *     the portal commit route creates with null term/payment regardless of type.
 *     A liability with no schedule CANNOT be amortized; without this guard an
 *     empty amortization schedule silently zeroes the balance, dropping the debt
 *     off the projection (net worth overstated). Holding it flat keeps the real
 *     balance on the projection. Deferred: real loan amortization from Plaid
 *     Liabilities (v2).
 *
 * A Plaid debt LINKED to an advisor-entered amortizing liability keeps that
 * liability's real termMonths (> 0), so it amortizes as before. This is correct
 * type-agnostically and is automatically bequest-safe (heir rows copy termMonths).
 */
export function isHeldFlatLiability(liab: {
  liabilityType?: LiabilityType | null;
  termMonths?: number | null;
}): boolean {
  return (
    isRevolvingLiability(liab) || liab.termMonths == null || liab.termMonths <= 0
  );
}
