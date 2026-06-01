// Data-independent: document.tsx calls page.estimatePageCount(undefined, options)
// during layout planning, before data exists. Bare () matches every sibling
// estimate*PageCount; the registry's (data, options) => number slot accepts it.
// The summary targets one landscape page; a large heir list may wrap to a second
// page at render time (accepted — see spec).
export function estimateEstateSummaryPageCount(): number {
  return 1;
}
