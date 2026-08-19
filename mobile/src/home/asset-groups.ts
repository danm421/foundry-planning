// mobile/src/home/asset-groups.ts
//
// The Net worth tile's "By type" breakdown. Pure — no react imports.
//
// The web renders the same `assetGroups` as a pie (asset-type-pie.tsx). The
// phone renders shares as bars, reusing the allocation-bar shape, so what has
// to match is the share each type holds of the asset side.
import type { NetWorthGroupLine } from "@contracts";

/**
 * Each asset category's share of the asset total, in the loader's
 * balance-sheet order, as `{ name, weight }` for AllocationBars.
 *
 * A negative subtotal is clamped to zero — asset-side totals shouldn't go
 * negative, but an overdrawn cash account can drag one under, and a negative
 * weight would invert the bar. Zero total yields zero weights rather than NaN.
 */
export function assetGroupWeights(
  groups: readonly NetWorthGroupLine[],
): { name: string; weight: number }[] {
  const totals = groups.map((g) => Math.max(0, g.total));
  const sum = totals.reduce((a, b) => a + b, 0);
  return groups.map((g, i) => ({
    name: g.label,
    weight: sum > 0 ? totals[i] / sum : 0,
  }));
}
