import type { TaxResult } from "./types";

/** Household "Other" tax = everything in Total Tax beyond Regular Federal
 *  (= totalTax − regularFederalIncomeTax). Single source of truth shared by the
 *  in-app Federal table and the PDF Federal / Other-Taxes view-models so the
 *  three renderers never drift. Regular Federal + Other == Total Tax holds by
 *  construction. Trust & beneficiary tax are NOT part of this (paid outside the
 *  household total). */
export function otherTaxFromFlow(flow: TaxResult["flow"] | undefined | null): number {
  if (!flow) return 0;
  return (flow.totalTax ?? 0) - (flow.regularFederalIncomeTax ?? 0);
}

/** Federal credits as they land in the "Other" bucket — always ≤ 0. Lives here,
 *  beside `otherTaxFromFlow`, because it is the component that makes that figure
 *  reconcile: BOTH itemizing surfaces (the in-app drill in
 *  components/cashflow/tax-detail-flow-table.tsx and the PDF drill in
 *  presentations/pages/income-tax-other-taxes) must derive it identically or their
 *  columns silently stop summing to their own totals.
 *
 *  SIGN. `otherTaxFromFlow` = totalTax − regularFederalIncomeTax, and
 *  `regularFederalIncomeTax` stays PRE-credit by design (calculate.ts:269).
 *  Expanding the roll-up (calculate.ts:277-281: totalFederalTax =
 *  max(0, subpartA − nonrefundable) + NIIT + addlMedicare − refundable, where
 *  subpartA = regularFed + capGains + AMT) gives
 *
 *      other = capGains + AMT + NIIT + addlMedicare + state + FICA + penalty
 *              − (taxCredits + refundableCredits)
 *
 *  so the named tax components OVERSHOOT the total by exactly the credit dollars
 *  and the component that closes the gap must be NEGATIVE.
 *
 *  No second clamp is needed: `flow.taxCredits` is already the APPLIED
 *  nonrefundable figure — credits.ts:199-211 caps each component against the
 *  remaining tax, so it can never exceed subpartA and the roll-up's `Math.max(0,…)`
 *  is a no-op safety rail rather than a clamp that would bend this arithmetic. */
export function creditsInOtherFromFlow(flow: TaxResult["flow"] | undefined | null): number {
  if (!flow) return 0;
  return -((flow.taxCredits ?? 0) + (flow.refundableCredits ?? 0));
}
