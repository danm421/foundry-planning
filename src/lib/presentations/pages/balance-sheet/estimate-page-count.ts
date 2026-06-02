// Page counts are computed before data exists (document.tsx passes undefined
// for data), so these must be data-independent — like every other page.
// The KPI strip + two short columns fit one LETTER page. The entities page
// flows to additional pages automatically via react-pdf when there are many
// entities; the estimate is a lower bound used only for the TOC/preview.
export function estimateBalanceSheetPageCount(): number {
  return 1;
}

export function estimateEntitiesBalanceSheetPageCount(): number {
  return 1;
}
