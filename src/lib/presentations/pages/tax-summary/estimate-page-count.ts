// Data-independent: document.tsx calls estimatePageCount(undefined, options) during
// layout planning. The tax summary is a single landscape page.
export function estimateTaxSummaryPageCount(): number {
  return 1;
}
