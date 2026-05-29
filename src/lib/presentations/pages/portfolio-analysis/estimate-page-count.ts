import type { PortfolioAnalysisData } from "./view-model";

/** Scatter on page 1, detail table on page 2. Data-independent: page counts
 *  are estimated before data exists (document.tsx passes undefined). */
export function estimatePortfolioAnalysisPageCount(
  _data?: PortfolioAnalysisData,
): number {
  return 2;
}
