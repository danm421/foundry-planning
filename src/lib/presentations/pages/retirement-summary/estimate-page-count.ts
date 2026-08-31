import type { RetirementSummaryPageData } from "./view-model";

/** Two portrait sheets — assets/outlook, then income/spending/funding — except
 *  on a scenario with no retirement data, whose empty state is a single sheet.
 *  Claiming two there shifted every later Contents entry by one. `data` is
 *  optional because the registry contract allows a data-free probe. */
export function estimateRetirementSummaryPageCount(data?: RetirementSummaryPageData): number {
  return data?.isEmpty ? 1 : 2;
}
