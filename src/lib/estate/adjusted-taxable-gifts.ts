import type { Gift, GiftEvent, EntitySummary } from "@/engine/types";

/**
 * Per-grantor cumulative post-1976 adjusted taxable gifts, per IRC §2001(b)(1)(B).
 * Used by the estate-tax module to compute Tentative Tax Base at death.
 *
 * Algorithm:
 * - For each cash `Gift` where `gift.grantor === decedent`: add `max(0, amount − annualExclusion(year))`.
 * - For each cash `Gift` where `gift.grantor === "joint"`: add `max(0, amount/2 − annualExclusion(year))`
 *   (attributed equally to both spouses).
 * - For each asset `GiftEvent` where `event.grantor === decedent`: add the gift-year value
 *   (amountOverride if set, otherwise accountValueAtYear(accountId, year) × percent).
 * - For each liability `GiftEvent`: contribute $0 — debt assumption is not a gift of value.
 * - For each entity where `entity.grantor === decedent`: add the entire
 *   `exemptionConsumed` opening advisor-entered balance. Third-party-grantor
 *   trusts (`entity.grantor === undefined`) contribute zero.
 *
 * @param accountValueAtYear - callback that returns the projected account balance
 *   for a given accountId at a given year. Used only for asset-transfer giftEvents
 *   without an amountOverride. Pass `() => 0` when no giftEvents are provided.
 * @param giftEvents - discriminated-union gift events (Phase 3+). Asset and liability
 *   transfer rows live here; cash rows may appear here OR in the legacy `gifts` array.
 */
export function computeAdjustedTaxableGifts(
  decedent: "client" | "spouse",
  gifts: Gift[],
  entities: EntitySummary[],
  annualExclusionsByYear: Record<number, number>,
  accountValueAtYear: (accountId: string, year: number) => number,
  giftEvents: GiftEvent[] = [],
): number {
  let total = 0;

  // Legacy cash-gift array (cash-only rows from the loader).
  for (const g of gifts) {
    const exclusion = annualExclusionsByYear[g.year] ?? 0;
    if (g.grantor === decedent) {
      total += Math.max(0, g.amount - exclusion);
    } else if (g.grantor === "joint") {
      total += Math.max(0, g.amount / 2 - exclusion);
    }
    // Other-grantor gifts contribute 0 to the current decedent's total.
  }

  // Phase 3 giftEvents — asset/liability transfers valued at gift-year.
  for (const ev of giftEvents) {
    if (ev.grantor !== decedent) continue;

    if (ev.kind === "cash") {
      // Cash giftEvents (series fan-outs or one-off cash) follow the same
      // annual-exclusion logic as legacy Gift rows.
      const exclusion = annualExclusionsByYear[ev.year] ?? 0;
      total += Math.max(0, ev.amount - exclusion);
    } else if (ev.kind === "asset") {
      // Asset transfer: advisor override takes precedence over engine-computed value.
      const contribution =
        ev.amountOverride != null
          ? ev.amountOverride
          : accountValueAtYear(ev.accountId, ev.year) * ev.percent;
      total += contribution;
    }
    // Liability transfers: debt assumption is not a gift of value → $0.
  }

  for (const e of entities) {
    if (e.grantor === decedent) {
      total += e.exemptionConsumed ?? 0;
    }
  }

  return total;
}
