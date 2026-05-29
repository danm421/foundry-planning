import type { PortfolioAnalysisData } from "./view-model";
/** Page 1 = scatter + legend; page 2 = the detail table (~35 rows/page). */
export function estimatePortfolioAnalysisPageCount(data: PortfolioAnalysisData): number {
  return 1 + Math.max(1, Math.ceil(data.tableRows.length / 35));
}
