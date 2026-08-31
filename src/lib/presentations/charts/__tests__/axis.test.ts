import { describe, it, expect } from "vitest";
import { niceAxisMax, axisTicks, bandLabelIndices } from "../axis";

describe("niceAxisMax", () => {
  // The defect: a retirement cash-flow chart whose bars peaked at $1.03M got a
  // $2.0M axis, so every bar drew in the bottom half of the panel.
  it("does not double the axis for a value just past a power of ten", () => {
    expect(niceAxisMax(1_029_000)).toBe(1_200_000);
    expect(niceAxisMax(103_000)).toBe(120_000);
    expect(niceAxisMax(10.3)).toBeCloseTo(12);
  });

  it("clears the data without burying it", () => {
    for (const v of [1, 7, 42, 999, 1_000, 1_001, 250_000, 693_000, 13_500_000, 20_180_000]) {
      const max = niceAxisMax(v);
      expect(max, `${v} must fit under ${max}`).toBeGreaterThanOrEqual(v);
      // No more than a third of the panel wasted above the tallest mark.
      expect(max, `${v} leaves too much dead space under ${max}`).toBeLessThan(v * 1.34);
    }
  });

  it("adds no headroom to a value already on a tick step", () => {
    expect(niceAxisMax(1_000_000)).toBe(1_000_000);
    expect(niceAxisMax(500_000)).toBe(500_000);
  });

  it("labels the top gridline — the ticks reach the max", () => {
    for (const v of [1_029_000, 693_000, 42, 13_500_000]) {
      const max = niceAxisMax(v);
      expect(axisTicks(max).at(-1)).toBeCloseTo(max, 6);
    }
  });

  it("falls back to 1 for an empty or negative series", () => {
    expect(niceAxisMax(0)).toBe(1);
    expect(niceAxisMax(-5)).toBe(1);
    expect(niceAxisMax(Number.NaN)).toBe(1);
  });
});

describe("bandLabelIndices", () => {
  // 59 years, a label roughly every 8 bands, the plan retiring at band 23.
  const YEARS = 59;

  it("always labels the last band, so the axis reaches the data", () => {
    const idx = bandLabelIndices(YEARS, { every: 8, minGap: 2 });
    expect(idx.at(-1)).toBe(YEARS - 1);
  });

  it("drops the regular label that would collide with a pinned one", () => {
    // Band 24 is 8 × 3; the retirement pin at 23 is one band away, which is how
    // the overlay chart printed `'49'50`.
    const idx = bandLabelIndices(YEARS, { every: 8, minGap: 2, pinned: [23] });
    expect(idx).toContain(23);
    expect(idx).not.toContain(24);
  });

  it("never places two labels closer than minGap", () => {
    const idx = bandLabelIndices(YEARS, { every: 8, minGap: 2, pinned: [23] });
    for (let i = 1; i < idx.length; i++) {
      expect(idx[i] - idx[i - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the evenly spaced run when nothing collides", () => {
    expect(bandLabelIndices(41, { every: 8, minGap: 2 })).toEqual([0, 8, 16, 24, 32, 40]);
  });

  it("handles a single band and an empty series", () => {
    expect(bandLabelIndices(1, { every: 8, minGap: 2 })).toEqual([0]);
    expect(bandLabelIndices(0, { every: 8, minGap: 2 })).toEqual([]);
  });
});
