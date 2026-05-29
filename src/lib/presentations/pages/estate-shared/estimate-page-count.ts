// Chart fits one portrait page.
export function estimateEstateChartPageCount(): number {
  return 1;
}

// The landscape report can spill to a second page on dense estates; a flat
// estimate of 2 keeps TOC page numbers stable enough for V1 (refine if drift
// is observed).
export function estimateEstateReportPageCount(): number {
  return 2;
}
