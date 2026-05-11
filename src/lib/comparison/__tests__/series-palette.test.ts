import { describe, it, expect } from "vitest";
import {
  seriesColor,
  seriesDash,
  seriesTintBg,
  SERIES_COLORS,
  MAX_PLANS,
} from "../series-palette";

describe("series-palette", () => {
  it("exposes a fixed palette of 4 entries", () => {
    expect(SERIES_COLORS).toHaveLength(4);
    expect(MAX_PLANS).toBe(4);
  });

  it("returns stable colors by index", () => {
    expect(seriesColor(0)).toBe("#cbd5e1"); // slate-300 (baseline)
    expect(seriesColor(1)).toBe("#34d399"); // emerald-400
    expect(seriesColor(2)).toBe("#fbbf24"); // amber-400
    expect(seriesColor(3)).toBe("#a78bfa"); // violet-400
  });

  it("returns dash patterns by index", () => {
    expect(seriesDash(0)).toEqual([2, 3]);   // dotted (baseline)
    expect(seriesDash(1)).toEqual([]);       // solid
    expect(seriesDash(2)).toEqual([8, 4]);   // long dash
    expect(seriesDash(3)).toEqual([4, 4]);   // short dash
  });

  it("returns a translucent background tint", () => {
    expect(seriesTintBg(0)).toMatch(/rgba\(203, 213, 225, 0\.0[0-9]+\)/);
    expect(seriesTintBg(1)).toMatch(/rgba\(52, 211, 153, 0\.0[0-9]+\)/);
  });

  it("returns undefined for out-of-range index", () => {
    expect(seriesColor(4)).toBeUndefined();
    expect(seriesDash(4)).toBeUndefined();
    expect(seriesTintBg(4)).toBeUndefined();
  });
});
