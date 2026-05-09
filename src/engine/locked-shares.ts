export interface AccrueLockedEntityShareInput {
  /** Carried locked EoY share from the prior year, or undefined for year 0. */
  carriedBoY: number | undefined;
  /** This year's account ledger snapshot — only `beginningValue` and `growth`
   *  are read; all flow entries are treated as household-attributable. */
  ledger: { beginningValue: number; growth: number };
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
 *  entity's slice. Mirrors balance-sheet / entity-cashflow accounting. */
export function accrueLockedEntityShare(
  input: AccrueLockedEntityShareInput,
): AccrueLockedEntityShareOutput {
  const { carriedBoY, ledger, percent } = input;
  const lockedBoY = carriedBoY ?? ledger.beginningValue * percent;
  const lockedGrowth = ledger.growth * percent;
  const lockedEoY = lockedBoY + lockedGrowth;
  return { lockedBoY, lockedGrowth, lockedEoY };
}
