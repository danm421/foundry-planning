/**
 * The ONLY place the gift ownership-share arithmetic lives.
 *
 * `gifts.percent` is `decimal(6, 4)` — an ownership FRACTION (0.25 = 25%) with
 * four decimal places, so 0.01% is the finest share the column can hold. Any
 * surface that derives a share (from a dollar target, from a typed percent)
 * must round to that scale BEFORE previewing it, or the figure on screen is not
 * the figure that gets saved.
 *
 * Sibling of `apply-valuation-discount.ts`, which owns the same arithmetic for
 * the `valuation_discount` column on the same table.
 */

/** Reciprocal of the stored scale: `decimal(6, 4)` holds 4 decimal places. */
export const GIFT_PERCENT_SCALE = 10_000;

/** Round an ownership fraction to what the column can hold, clamped to 0–100%.
 *  A non-finite input (an empty or half-typed field) is no share at all. */
export function roundGiftPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(
    1,
    Math.max(0, Math.round(fraction * GIFT_PERCENT_SCALE) / GIFT_PERCENT_SCALE),
  );
}

/** Stored fraction → whole percent for display or a form input (0.0425 → 4.25).
 *  Two decimals, because that is exactly what the stored scale can express. */
export function giftPercentToWhole(fraction: number): number {
  return Math.round(fraction * GIFT_PERCENT_SCALE) / 100;
}

/** Whole percent typed into a form → the stored fraction (4.25 → 0.0425). */
export function wholeToGiftPercent(whole: number): number {
  return roundGiftPercent(whole / 100);
}
