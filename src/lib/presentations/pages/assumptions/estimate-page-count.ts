import type { AssumptionsPageData } from "./types";
import type { AssumptionsPageOptions } from "./options-schema";

// Data-independent: document.tsx calls page.estimatePageCount(undefined, options)
// during layout planning, before data exists. `_data` is accepted (and typed)
// only so the registry's (data, options) => number slot lines up — see the
// estate-summary sibling for the same contract.
// Overview is 1 page. The account table adds 1 page; the appendix (portfolios
// + CMA) adds another when enabled.
export function estimateAssumptionsPageCount(
  _data: AssumptionsPageData,
  options: AssumptionsPageOptions,
): number {
  return 1 + (options.includeAccountTable ? 1 : 0) + (options.includeCmaAppendix ? 1 : 0);
}
