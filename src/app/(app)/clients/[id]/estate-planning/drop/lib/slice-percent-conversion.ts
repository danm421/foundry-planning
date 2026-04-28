/**
 * Slice ↔ asset percent conversion for the unified DropPopup math.
 *
 * Context: when an account is co-owned (e.g. Tom 60% / Linda 40%), the user
 * thinks in terms of "100% of Tom's slice" — i.e. fraction of the named
 * owner's stake. The API expresses transfers as fraction of the whole asset.
 *
 * Example: Tom owns 60% of a $2M account. His slice is $1.2M.
 *   - Gifting 100% of Tom's slice → 60% of the asset.
 *   - Gifting 50% of Tom's slice → 30% of the asset.
 */

export function sliceToAsset(slicePct: number, ownerSlice: number): number {
  if (slicePct <= 0 || slicePct > 1) throw new Error("slicePct out of (0,1]");
  if (ownerSlice <= 0 || ownerSlice > 1) throw new Error("ownerSlice out of (0,1]");
  return slicePct * ownerSlice;
}

export function assetToSlice(assetPct: number, ownerSlice: number): number {
  if (ownerSlice <= 0) throw new Error("ownerSlice must be > 0");
  return assetPct / ownerSlice;
}
