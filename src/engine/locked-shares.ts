export interface AccrueLockedEntityShareInput {
  /** Carried locked EoY share from the prior year, or undefined for year 0. */
  carriedBoY: number | undefined;
  /** The percent `carriedBoY` was locked at. When this year's `percent` is
   *  HIGHER — a later gift raised the entity's share — the newly gifted slice
   *  is added on top of the carry. Omitted, or a flat/falling percent, keeps
   *  the carry as-is. */
  carriedPercent?: number;
  /** This year's account ledger snapshot — only `beginningValue`, `growth`,
   *  and `endingValue` are read; all flow entries are treated as
   *  household-attributable. */
  ledger: { beginningValue: number; growth: number; endingValue: number };
  /** Entity owner's share of the account (0..1). */
  percent: number;
}

export interface AccrueLockedEntityShareOutput {
  lockedBoY: number;
  lockedGrowth: number;
  lockedEoY: number;
}

/** Single-year locked-share roll-forward for an entity owner on a split-owned
 *  account. The entity's slice is locked to its prior carry (or
 *  `beginningValue × percent` at year 0) plus its proportional share of
 *  passive growth. Household withdrawals on the account never reduce the
 *  entity's slice — but the slice can never exceed what the account actually
 *  holds: once outflows (sales, drains) push the balance below the carry, the
 *  entity's share IS the balance, and a fully drained account carries 0
 *  forward (audit F3). Mirrors balance-sheet / entity-cashflow accounting. */
export function accrueLockedEntityShare(
  input: AccrueLockedEntityShareInput,
): AccrueLockedEntityShareOutput {
  const { carriedBoY, carriedPercent, ledger, percent } = input;
  // A second gift of the same account: the carry holds only the FIRST slice,
  // so without the top-up the entity stays at its old share forever while
  // growth accrues at the new percent on that stale base.
  const topUp =
    carriedPercent !== undefined && percent > carriedPercent
      ? (percent - carriedPercent) * ledger.beginningValue
      : 0;
  const lockedBoY =
    carriedBoY === undefined ? ledger.beginningValue * percent : carriedBoY + topUp;
  const lockedGrowth = ledger.growth * percent;
  const lockedEoY = Math.min(
    lockedBoY + lockedGrowth,
    Math.max(0, ledger.endingValue),
  );
  return { lockedBoY, lockedGrowth, lockedEoY };
}
