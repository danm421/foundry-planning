// Data-independent (document.tsx calls this with no data). Long reports flow
// across pages via react-pdf `wrap`; the page-number estimate inherits the same
// limitation as other variable-length pages (e.g. Monte Carlo, cash-flow drills).
export function estimateScenarioChangesPageCount(): number {
  return 1;
}
