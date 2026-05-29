import type { PortfolioAnalysisOptions } from "./options-schema";
const SORT_LABEL: Record<PortfolioAnalysisOptions["sortKey"], string> = {
  name: "name", return: "return", mean: "mean", stdDev: "σ", sharpe: "Sharpe", value: "value",
};
export function summarizePortfolioAnalysisOptions(o: PortfolioAnalysisOptions): string {
  const count = o.selectedKeys.length === 0 ? "default" : `${o.selectedKeys.length}`;
  return `${count} entities · sorted by ${SORT_LABEL[o.sortKey]}`;
}
