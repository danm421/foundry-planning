/**
 * Valuation-discount arithmetic for transfer-tax purposes.
 *
 * When a client gives away a fractional interest in a family LLC, an FLP, or a
 * building, the interest is worth less on the open market than its share of the
 * underlying assets — the holder cannot force a sale or a distribution. An
 * appraiser prices that in as a discount for lack of marketability and lack of
 * control, and the IRS accepts it.
 *
 * This module is the ONLY place the discount arithmetic lives. It is pure and
 * framework-free — no engine, Next.js, or DB imports — so it is importable from
 * the engine, from lib, and from client components alike.
 *
 * The single production insertion point is `toCanonicalGifts` in
 * `normalize-gifts.ts`. Do NOT push the discount down into
 * `computeGiftTaxTreatment`: the §2503(b) pooling in `gift-ledger.ts` and
 * `build-recipient-drilldown.ts` sums canonical amounts across a donee group
 * BEFORE treating them, so a discount applied inside the treatment function
 * would be applied to an already-pooled total mixing discounted and
 * undiscounted gifts.
 */

/**
 * Coerce an advisor-supplied discount into a usable fraction in `[0, 1]`.
 *
 * `null` / `undefined` / `0` / a negative / `NaN` all mean "no discount" and
 * return `0`. Anything at or above `1` is clamped to exactly `1` — Zod and a
 * table `CHECK` both reject `d >= 1`, so this clamp only ever fires on data
 * that bypassed both, and it must fail toward a $0 gift rather than a negative
 * one.
 */
export function normalizeValuationDiscount(
  discount: number | null | undefined,
): number {
  if (discount == null || !Number.isFinite(discount) || discount <= 0) return 0;
  return Math.min(discount, 1);
}

/**
 * Transfer-tax value of a gift after a lack-of-marketability / lack-of-control
 * discount.
 *
 * `fullValue` is the undiscounted fair market value of the transferred
 * interest — what the recipient's balance sheet keeps showing. `discount` is a
 * fraction: `0.30` means a 30% discount, so a $1,000,000 interest is a
 * $700,000 gift for §2512 purposes.
 */
export function discountedGiftValue(
  fullValue: number,
  discount: number | null | undefined,
): number {
  return fullValue * (1 - normalizeValuationDiscount(discount));
}
