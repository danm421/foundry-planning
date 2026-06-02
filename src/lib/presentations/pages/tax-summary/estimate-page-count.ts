// Data-independent: document.tsx calls estimatePageCount(undefined, options) during
// layout planning. The summary is one landscape page; when the plan has planning
// opportunities a second physical page is emitted at render time — the same
// accepted estimate/realized drift as the Monte Carlo and estate pages. The
// footer auto-numbers via @react-pdf, so visible page numbers are always correct.
export function estimateTaxSummaryPageCount(): number {
  return 1;
}
