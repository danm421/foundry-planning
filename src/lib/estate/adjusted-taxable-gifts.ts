import type { Gift, EntitySummary } from "@/engine/types";

/**
 * Per-grantor cumulative post-1976 adjusted taxable gifts, per IRC §2001(b)(1)(B).
 * Used by the estate-tax module to compute Tentative Tax Base at death.
 *
 * Algorithm:
 * - For each gift where `gift.grantor === decedent`: add `max(0, amount − annualExclusion(year))`.
 * - For each gift where `gift.grantor === "joint"`: add `max(0, amount/2 − annualExclusion(year))`
 *   (attributed equally to both spouses).
 * - For each entity where `entity.grantor === decedent`: add the entire
 *   `exemptionConsumed` opening advisor-entered balance. Third-party-grantor
 *   trusts (`entity.grantor === undefined`) contribute zero.
 */
export function computeAdjustedTaxableGifts(
  decedent: "client" | "spouse",
  gifts: Gift[],
  entities: EntitySummary[],
  annualExclusionsByYear: Record<number, number>,
): number {
  let total = 0;

  for (const g of gifts) {
    const exclusion = annualExclusionsByYear[g.year] ?? 0;
    if (g.grantor === decedent) {
      total += Math.max(0, g.amount - exclusion);
    } else if (g.grantor === "joint") {
      total += Math.max(0, g.amount / 2 - exclusion);
    }
    // Other-grantor gifts contribute 0 to the current decedent's total.
  }

  for (const e of entities) {
    if (e.grantor === decedent) {
      total += e.exemptionConsumed ?? 0;
    }
  }

  return total;
}
