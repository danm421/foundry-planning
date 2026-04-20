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

import type { AssetTypeId } from "./asset-types";

// Base hues for each asset type. Picked from Tailwind 500-range for parity
// with the existing 12-color class palette.
export const ASSET_TYPE_PALETTE: Record<AssetTypeId, string> = {
  equities:         "#3b82f6", // blue-500
  taxable_bonds:    "#10b981", // emerald-500
  tax_exempt_bonds: "#8b5cf6", // violet-500
  cash:             "#f59e0b", // amber-500
  other:            "#6b7280", // gray-500
};

export function colorForAssetType(typeId: AssetTypeId): string {
  return ASSET_TYPE_PALETTE[typeId];
}

// --- HSL helpers (for Combined-mode class shading) ---
//
// Given a type's base hex color, step the HSL lightness channel to generate
// distinguishable shades for each class within that type. Keeps hue and
// saturation fixed, moves lightness in a symmetric pattern around the base.

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return { h: 0, s: 0, l: 50 };
  const r = parseInt(m[1]!, 16) / 255;
  const g = parseInt(m[2]!, 16) / 255;
  const b = parseInt(m[3]!, 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = Math.max(0, Math.min(100, s)) / 100;
  const lN = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (0 <= hp && hp < 1) { r = c; g = x; b = 0; }
  else if (1 <= hp && hp < 2) { r = x; g = c; b = 0; }
  else if (2 <= hp && hp < 3) { r = 0; g = c; b = x; }
  else if (3 <= hp && hp < 4) { r = 0; g = x; b = c; }
  else if (4 <= hp && hp < 5) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const m = lN - c / 2;
  const toHex = (v: number) => {
    const n = Math.round((v + m) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const LIGHTNESS_STEP_PCT = 8; // symmetric steps around the base
const MIN_L = 25;
const MAX_L = 75;

/**
 * Derive a distinct shade for one class within its asset type.
 *
 * index: 0..totalClassesInType-1
 * totalClassesInType: how many classes share this type on screen
 *
 * Stepping pattern around the type's base lightness: 0, +step, -step, +2step,
 * -2step, ... clamped to [MIN_L, MAX_L]. The first class (index 0) always
 * returns the base color.
 */
export function shadeForClassInType(
  typeId: AssetTypeId,
  index: number,
  totalClassesInType: number,
): string {
  const base = ASSET_TYPE_PALETTE[typeId];
  if (totalClassesInType <= 1 || index <= 0) return base;
  const { h, s, l } = hexToHsl(base);
  const safeIdx = Math.max(0, Math.min(index, totalClassesInType - 1));
  // alternating: 1 → +1*step, 2 → -1*step, 3 → +2*step, 4 → -2*step ...
  const magnitude = Math.ceil(safeIdx / 2);
  const sign = safeIdx % 2 === 1 ? 1 : -1;
  const l2 = Math.max(MIN_L, Math.min(MAX_L, l + sign * magnitude * LIGHTNESS_STEP_PCT));
  return hslToHex(h, s, l2);
}
