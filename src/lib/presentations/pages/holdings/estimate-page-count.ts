import type { HoldingsPageData } from "./types";
import type { HoldingsPageOptions } from "./options-schema";

// Data-independent: document.tsx calls page.estimatePageCount(undefined, options)
// during layout planning, before data exists. Long holdings lists wrap onto
// extra physical pages at render time; the deck's page-number plan accepts that
// drift (spec decision) — same contract as the estate-summary sibling.
export function estimateHoldingsPageCount(
  _data: HoldingsPageData,
  _options: HoldingsPageOptions,
): number {
  return 1;
}
