import type { AnalysisRow, EntityType } from "@/lib/investments/portfolio-analysis";
import { colorForAssetClass } from "@/lib/investments/palette";

export interface SeriesDef {
  type: EntityType;
  label: string;
  pointStyle: string;
  color: string;
}

// Shared by the scatter chart and the selection controls so point colors and
// selected-list dots stay in lockstep. Order also drives grouping in the picker.
export const SERIES: SeriesDef[] = [
  { type: "asset_class", label: "Asset Classes", pointStyle: "circle", color: "#3b82f6" },
  { type: "account", label: "Accounts", pointStyle: "rect", color: "#10b981" },
  { type: "category", label: "Account Categories", pointStyle: "triangle", color: "#f59e0b" },
  { type: "custom_group", label: "Custom Groups", pointStyle: "rectRot", color: "#8b5cf6" },
  { type: "model_portfolio", label: "Model Portfolios", pointStyle: "star", color: "#ec4899" },
];

export const SERIES_BY_TYPE = Object.fromEntries(
  SERIES.map((s) => [s.type, s]),
) as Record<EntityType, SeriesDef>;

export function labelForType(type: EntityType): string {
  return SERIES_BY_TYPE[type].label;
}

/** Category color for a row — used in the picker to hint each item's group. */
export function colorForRow(row: AnalysisRow): string {
  if (row.type === "asset_class" && row.sortOrder !== undefined) {
    return colorForAssetClass({ sortOrder: row.sortOrder });
  }
  return SERIES_BY_TYPE[row.type].color;
}

/** A distinct hue per plotted item, evenly spread for maximum separation. */
export function colorForIndex(index: number, total: number): string {
  const hue = total > 1 ? Math.round((index / total) * 360) : 210;
  return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Assign every plotted row its own color, keyed by row.key so the chart,
 * legend, table, and selected list all resolve to the same color for an item.
 */
export function buildColorMap(rows: AnalysisRow[]): Map<string, string> {
  const map = new Map<string, string>();
  rows.forEach((r, i) => map.set(r.key, colorForIndex(i, rows.length)));
  return map;
}
