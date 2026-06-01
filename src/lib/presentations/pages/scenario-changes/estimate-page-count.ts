// Data-independent (document.tsx calls this before data exists). Long reports
// flow across pages via react-pdf `wrap`; the page-number estimate inherits the
// same limitation as other variable-length pages (e.g. Monte Carlo, cash-flow
// drills). Takes no params, matching every sibling estimate*PageCount — the
// registry's (data, options) => number slot accepts a zero-arg function.
export function estimateScenarioChangesPageCount(): number {
  return 1;
}
