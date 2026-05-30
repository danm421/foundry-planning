//
// Maps a deterministic projection to a monotonic funding score for bisect.
// >= 1.0  => fully funded (liquid never negative).
// in (0,1) => partially funded; lower = deeper shortfall relative to the
//             plan's peak liquid assets (a stable, lever-monotonic scale).
import type { ProjectionYear } from "@/engine/types";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";

export function fundingScore(years: ProjectionYear[]): number {
  if (years.length === 0) return 0;
  const liquids = years.map((y) => liquidPortfolioTotal(y));
  const minLiquid = Math.min(...liquids);
  if (minLiquid >= 0) return 1; // fully funded
  const peak = Math.max(1, ...liquids.map((v) => Math.abs(v)));
  // minLiquid is negative; deeper deficit -> closer to 0.
  return Math.max(0, 1 + minLiquid / peak);
}
