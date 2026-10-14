// src/lib/whatif/rank.ts
//
// Ranks a comparison by one measure. Rows keep the order the advisor asked
// for; `rank` is added beside them. Failed rows and rows without the measure
// stay where they are, with a null rank.
import { METRIC_KEYS, type MetricKey } from "./metrics";
import type { VariantResult } from "./run";

export const RANK_METRICS = [...METRIC_KEYS, "solvedValue"] as const;
export type RankMetric = MetricKey | "solvedValue";

const DEFAULT_DIRECTION: Record<RankMetric, "asc" | "desc"> = {
  successRate: "desc",
  endingPortfolio: "desc",
  lifetimeTax: "asc",
  netToHeirs: "desc",
  heirIncomeTax: "asc",
  yearsFullyFunded: "desc",
  solvedValue: "desc",
};

function valueOf(r: VariantResult, metric: RankMetric): number | null {
  if (r.status !== "done") return null;
  if (metric === "solvedValue") return r.solve?.value ?? null;
  const v = r.metrics?.[metric];
  return typeof v === "number" ? v : null;
}

export function rankVariants(
  rows: VariantResult[],
  rankBy?: { metric: RankMetric; direction?: "asc" | "desc" },
): { rows: VariantResult[]; best: string | null } {
  if (!rankBy) return { rows, best: null };
  const dir = rankBy.direction ?? DEFAULT_DIRECTION[rankBy.metric];
  const scored = rows.map((r, i) => ({ i, v: valueOf(r, rankBy.metric) }));
  const ranked = scored
    .filter((s): s is { i: number; v: number } => s.v !== null)
    .sort((a, b) => (dir === "asc" ? a.v - b.v : b.v - a.v));
  const rankOf = new Map(ranked.map((s, pos) => [s.i, pos + 1]));
  return {
    rows: rows.map((r, i) => ({ ...r, rank: rankOf.get(i) ?? null })),
    best: ranked.length > 0 ? rows[ranked[0].i].label : null,
  };
}
