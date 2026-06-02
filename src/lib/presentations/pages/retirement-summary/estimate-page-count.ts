// Data-independent: document.tsx calls estimatePageCount(undefined, options) during
// layout planning. The retirement summary is two portrait pages.
export function estimateRetirementSummaryPageCount(): number {
  return 2;
}
