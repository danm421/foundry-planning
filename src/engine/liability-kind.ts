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
