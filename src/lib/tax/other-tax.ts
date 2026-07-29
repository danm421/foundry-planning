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
 *  subpartA = regularFed + capGains + AMT) and then adding the terms
 *  src/engine/year-tax.ts folds in post-hoc gives the FULL identity:
 *
 *      other = capGains + AMT + NIIT + addlMedicare + state + FICA + penalty
 *              + seTax
 *              − (taxCredits + refundableCredits)
 *
 *  so the named tax components OVERSHOOT the total by exactly the credit dollars
 *  and the component that closes the gap must be NEGATIVE.
 *
 *  ⚠️ `seTax` IS UNLINED — the itemizing surfaces CANNOT capture it. Of the three
 *  terms src/engine/year-tax.ts folds in after the fact, two also land on a flow
 *  line field and so are already columned: the transfer early-withdrawal penalty
 *  (`:227-231` → `flow.earlyWithdrawalPenalty`) and the SE-side additional
 *  Medicare surtax (`:243-247` → `flow.additionalMedicare`). SECA is the
 *  exception: `:233-236` adds `secaResult.seTax` to `totalTax`/`totalFederalTax`
 *  ONLY, and `TaxResult["flow"]` has no `seTax` field at all. So for a
 *  SELF-EMPLOYED household the named columns + this credits component still fall
 *  short of the Other total by `seTax`, and no amount of work in the view-models
 *  can close that — giving SECA a column is an ENGINE change (new flow field,
 *  populated in year-tax.ts, plus a consumer sweep). Logged as future work;
 *  deliberately NOT fixed here. Do not "fix" the arithmetic below to compensate:
 *  the credits term is exactly right, the gap is a missing field elsewhere.
 *
 *  No second clamp is needed: `flow.taxCredits` is already the APPLIED
 *  nonrefundable figure — credits.ts:199-211 caps each component against the
 *  remaining tax, so it can never exceed subpartA and the roll-up's `Math.max(0,…)`
 *  is a no-op safety rail rather than a clamp that would bend this arithmetic. */
export function creditsInOtherFromFlow(flow: TaxResult["flow"] | undefined | null): number {
  if (!flow) return 0;
  return -((flow.taxCredits ?? 0) + (flow.refundableCredits ?? 0));
}
