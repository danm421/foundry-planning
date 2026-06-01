import type { AnalysisRow, EntityType } from "@/lib/investments/portfolio-analysis";
import { colorForAssetClass } from "@/lib/investments/palette";
import { data, dataScale } from "@/brand";

export interface SeriesDef {
  type: EntityType;
  label: string;
  pointStyle: string;
  color: string;
}

// Shared by the scatter chart and the selection controls so point colors and
// selected-list dots stay in lockstep. Order also drives grouping in the picker.
export const SERIES: SeriesDef[] = [
  { type: "asset_class", label: "Asset Classes", pointStyle: "circle", color: data.slate },
  { type: "account", label: "Accounts", pointStyle: "rect", color: data.emerald },
  { type: "category", label: "Account Categories", pointStyle: "triangle", color: data.wheat },
  { type: "custom_group", label: "Custom Groups", pointStyle: "rectRot", color: data.violet },
  { type: "model_portfolio", label: "Model Portfolios", pointStyle: "star", color: data.rose },
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

/** A distinct hue per plotted item, evenly spread in the editorial data band. */
export function colorForIndex(index: number, total: number): string {
  const scale = dataScale(Math.max(total, 1), "dark");
  return scale[index % scale.length]!;
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
