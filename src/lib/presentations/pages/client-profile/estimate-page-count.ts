// Data-independent (per the page-count convention): a profile is one page;
// income-heavy households wrap to a second page at render time.
export function estimateClientProfilePageCount(): number {
  return 1;
}
