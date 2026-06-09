import type { Gift, GiftEvent, EntitySummary } from "@/engine/types";
import { toCanonicalGifts, treatCanonicalGift } from "@/lib/gifts/normalize-gifts";

/**
 * Per-grantor cumulative post-1976 adjusted taxable gifts, per IRC §2001(b)(1)(B).
 * Used by the estate-tax module to compute Tentative Tax Base at death.
 *
 * Routes both the legacy `gifts[]` array and `giftEvents[]` through the unified
 * canonical+treatment model ({@link toCanonicalGifts} → {@link treatCanonicalGift}),
 * keeping this addback in lock-step with the gift-ledger's lifetime-exemption math:
 * - Charitable gifts → $0 lifetime used (fully deductible).
 * - Crummey trust → `amount − annualExclusion × crummeyBeneficiaryCount`.
 * - Non-Crummey irrevocable trust → full `amount` (no annual exclusion).
 * - Family member / individual / no modeled recipient → `amount − one annualExclusion`.
 * - Joint gifts are split 50/50 across spouses before treatment (§2513).
 * - Asset / business-interest transfers are valued at the gift-year balance and
 *   consume full lifetime exemption (Crummey is cash-only). Liability transfers → $0.
 *
 * `entities` supplies each recipient trust's `isIrrevocable` / `entityType` and
 * Crummey beneficiary count to the treatment. `entity.exemptionConsumed` is a
 * loader-derived display value and is NOT consumed (counting it would double-count
 * gifts already in `gifts` / `giftEvents` — see commit 186a97a).
 *
 * @param accountValueAtYear - callback that returns the projected account balance
 *   for a given accountId at a given year. Used only for asset-transfer giftEvents
 *   without an amountOverride. Pass `() => 0` when no giftEvents are provided.
 * @param giftEvents - discriminated-union gift events. Asset and liability transfer rows are
 *   exclusively here. Cash rows here are SERIES FAN-OUTS (seriesId) or synthesized premium
 *   gifts (sourcePolicyAccountId) only; one-time cash gifts come through the legacy `gifts`
 *   array to avoid double-counting.
 */
export function computeAdjustedTaxableGifts(
  decedent: "client" | "spouse",
  gifts: Gift[],
  entities: EntitySummary[],
  annualExclusionsByYear: Record<number, number>,
  accountValueAtYear: (accountId: string, year: number) => number,
  giftEvents: GiftEvent[] = [],
): number {
  return computeAdjustedTaxableGiftsByYear(
    decedent,
    gifts,
    entities,
    annualExclusionsByYear,
    accountValueAtYear,
    giftEvents,
  ).reduce((sum, g) => sum + g.amount, 0);
}

/**
 * Per-gift-year breakdown of {@link computeAdjustedTaxableGifts}: each entry is the
 * total post-annual-exclusion lifetime-exemption contribution for a single year. The
 * amounts sum to the scalar `computeAdjustedTaxableGifts` total. State estate-tax
 * modules use the year tags to apply statutory gift-addback lookback windows
 * (ME/VT/MN/NY); the federal Form 706 line always uses the full sum.
 *
 * Years with zero net contribution are omitted. Contributions are aggregated by year
 * (one entry per year) and sorted ascending so output is deterministic regardless of
 * gift/event ordering.
 */
export function computeAdjustedTaxableGiftsByYear(
  decedent: "client" | "spouse",
  gifts: Gift[],
  entities: EntitySummary[],
  annualExclusionsByYear: Record<number, number>,
  accountValueAtYear: (accountId: string, year: number) => number,
  giftEvents: GiftEvent[] = [],
): Array<{ year: number; amount: number }> {
  const canonical = toCanonicalGifts(gifts, giftEvents, { entities, accountValueAtYear });
  const byYear = new Map<number, number>();
  for (const cg of canonical) {
    if (cg.grantor !== decedent) continue;
    const used = treatCanonicalGift(cg, annualExclusionsByYear[cg.year] ?? 0).lifetimeUsed;
    if (used > 0) byYear.set(cg.year, (byYear.get(cg.year) ?? 0) + used);
  }
  return [...byYear.entries()]
    .map(([year, amount]) => ({ year, amount }))
    .sort((a, b) => a.year - b.year);
}
