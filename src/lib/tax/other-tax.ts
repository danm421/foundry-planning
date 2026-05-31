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
