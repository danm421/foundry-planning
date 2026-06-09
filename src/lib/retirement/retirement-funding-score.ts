//
// Maps a deterministic projection to a continuous, monotonic funding score for bisect.
// == 1.0 exactly at the funded boundary (liquid never negative, min === 0).
// > 1.0  => surplus (liquid stays positive throughout).
// in (0,1) => partially funded; lower = deeper shortfall relative to the
//             plan's peak liquid assets (a stable, lever-monotonic scale).
import type { ProjectionYear } from "@/engine/types";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";

export function fundingScore(years: ProjectionYear[]): number {
  if (years.length === 0) return 0;
  const liquids = years.map((y) => liquidPortfolioTotal(y));
  const minLiquid = Math.min(...liquids);
  const peak = Math.max(1, ...liquids.map((v) => Math.abs(v)));
  // Continuous & monotonic in the lever: == 1.0 at the funded boundary
  // (minLiquid === 0), > 1 with surplus, < 1 (toward 0) with deeper shortfall.
  // A continuous gradient lets bisect converge on the boundary; a binary 0/1
  // score would make bisect's tolerance early-exit return underfunded plans.
  return Math.max(0, 1 + minLiquid / peak);
}
