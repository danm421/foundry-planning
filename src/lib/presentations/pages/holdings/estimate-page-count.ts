// Data-independent: document.tsx calls page.estimatePageCount(undefined, options)
// during layout planning, before data exists, so this takes no arguments — like
// the asset-allocation sibling. Long holdings lists wrap onto extra physical
// pages at render time; the deck's page-number plan accepts that drift (spec
// decision) — same contract as the estate-summary sibling.
export function estimateHoldingsPageCount(): number {
  return 1;
}
