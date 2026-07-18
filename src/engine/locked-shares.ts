export interface AccrueLockedEntityShareInput {
  /** Carried locked EoY share from the prior year, or undefined for year 0. */
  carriedBoY: number | undefined;
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
  const { carriedBoY, ledger, percent } = input;
  const lockedBoY = carriedBoY ?? ledger.beginningValue * percent;
  const lockedGrowth = ledger.growth * percent;
  const lockedEoY = Math.min(
    lockedBoY + lockedGrowth,
    Math.max(0, ledger.endingValue),
  );
  return { lockedBoY, lockedGrowth, lockedEoY };
}
