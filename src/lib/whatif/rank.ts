// src/lib/whatif/rank.ts
//
// Ranks a comparison by one measure. Rows keep the order the advisor asked
// for; `rank` is added beside them. Failed rows and rows without the measure
// stay where they are, with a null rank.
import type { SolveFor } from "./changes";
import { WhatIfValidationError } from "./errors";
import { METRIC_KEYS, type MetricKey } from "./metrics";
import type { VariantResult } from "./run";

export const RANK_METRICS = [...METRIC_KEYS, "solvedValue"] as const;
export type RankMetric = MetricKey | "solvedValue";

type Direction = "asc" | "desc";
export interface RankBy {
  metric: RankMetric;
  direction?: Direction;
}
type SolveKind = SolveFor["kind"];

const METRIC_DIRECTION: Record<MetricKey, Direction> = {
  successRate: "desc",
  endingPortfolio: "desc",
  lifetimeTax: "asc",
  netToHeirs: "desc",
  heirIncomeTax: "asc",
  yearsFullyFunded: "desc",
};

/** Which solved value is better, by solve kind. Retirement-age and savings
 *  solves return the smallest lever value that reaches the target (searched
 *  up from the low end, lever-search-config.ts), so lower is better. Max
 *  spending returns the most that can be spent, so higher is. A Roth amount
 *  or claim age has no better side; the advisor has to say. */
const SOLVED_VALUE_DIRECTION: Record<SolveKind, Direction | null> = {
  max_spending: "desc",
  retirement_age: "asc",
  savings: "asc",
  roth_amount: null,
  ss_claim_age: null,
};

/** The direction `rankBy` ranks in, or the reason it can't rank these solves. */
function directionFor(rankBy: RankBy, solveKinds: (SolveKind | null)[]): { direction: Direction } | { refusal: string } {
  if (rankBy.metric !== "solvedValue") return { direction: rankBy.direction ?? METRIC_DIRECTION[rankBy.metric] };
  const kinds = [...new Set(solveKinds.filter((k): k is SolveKind => k !== null))];
  if (kinds.length === 0) {
    return { refusal: "rankBy solvedValue needs variations with a solveFor. Rank by another measure instead." };
  }
  if (kinds.length > 1) {
    return {
      refusal: `rankBy solvedValue can't compare different solves (${kinds.join(", ")}). Give every variation the same solveFor kind, or rank by another measure.`,
    };
  }
  const direction = rankBy.direction ?? SOLVED_VALUE_DIRECTION[kinds[0]];
  if (!direction) {
    return {
      refusal: `rankBy solvedValue for a ${kinds[0]} solve needs a direction: 'asc' ranks the lowest value first, 'desc' the highest.`,
    };
  }
  return { direction };
}

/** Refuses a rankBy that can't rank these variations. Call it before any
 *  compute, with each variation's solveFor kind (null when it has none). */
export function checkRankBy(rankBy: RankBy | undefined, solveKinds: (SolveKind | null)[]): void {
  if (!rankBy) return;
  const out = directionFor(rankBy, solveKinds);
  if ("refusal" in out) throw new WhatIfValidationError(out.refusal);
}

function valueOf(r: VariantResult, metric: RankMetric): number | null {
  if (r.status !== "done") return null;
  if (metric === "solvedValue") return r.solve?.value ?? null;
  const v = r.metrics?.[metric];
  return typeof v === "number" ? v : null;
}

/** Never throws: a rankBy that checkRankBy would refuse ranks nothing here. */
export function rankVariants(rows: VariantResult[], rankBy?: RankBy): { rows: VariantResult[]; best: string | null } {
  if (!rankBy) return { rows, best: null };
  const resolved = directionFor(rankBy, rows.map((r) => r.solve?.kind ?? null));
  if ("refusal" in resolved) return { rows: rows.map((r) => ({ ...r, rank: null })), best: null };
  const dir = resolved.direction;
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
