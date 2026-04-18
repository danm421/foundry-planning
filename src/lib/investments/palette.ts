// 12-color palette drawn from Tailwind 500-range hues, chosen for high
// distinguishability on a dark surface. Keep length at 12 — tests pin this.
const PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f43f5e", // rose
  "#84cc16", // lime
  "#6366f1", // indigo
  "#f97316", // orange
  "#06b6d4", // cyan
  "#a855f7", // purple
] as const;

export const UNALLOCATED_COLOR = "#6b7280"; // gray-500

export function colorForAssetClass(assetClass: { id?: string; sortOrder: number }): string {
  const n = PALETTE.length;
  const idx = ((assetClass.sortOrder % n) + n) % n;
  return PALETTE[idx]!;
}
