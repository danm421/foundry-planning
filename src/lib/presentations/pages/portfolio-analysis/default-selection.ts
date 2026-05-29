import type { AnalysisRow } from "@/lib/investments/portfolio-analysis";
/** Sensible default: asset classes + account categories + model portfolios
 *  (skip individual accounts and custom groups to avoid a crowded scatter). */
export function defaultAnalysisSelection(rows: AnalysisRow[]): string[] {
  return rows
    .filter((r) => r.type === "asset_class" || r.type === "category" || r.type === "model_portfolio")
    .map((r) => r.key);
}
