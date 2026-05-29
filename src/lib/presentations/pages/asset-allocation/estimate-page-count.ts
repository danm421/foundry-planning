/** Donuts + table + optional drift fit a single page in the common case.
 *  Page counts are computed before data exists (document.tsx passes undefined
 *  for data), so this must be data-independent — like every other page. */
export function estimateAssetAllocationPageCount(): number {
  return 1;
}
