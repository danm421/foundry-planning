import { describe, it, expect } from "vitest";
import {
  computePresets,
  isPresetActive,
  clampRange,
  computeAxisLabels,
} from "../year-range-utils";

describe("computePresets", () => {
  it("returns full = [planStart, planEnd] always", () => {
    const presets = computePresets(2026, 2076, 2040);
    expect(presets.full).toEqual([2026, 2076]);
  });

  it("with retirement year mid-projection: working ends day before retirement, retirement starts at retirement year", () => {
    const presets = computePresets(2026, 2076, 2040);
    expect(presets.working).toEqual([2026, 2039]);
    expect(presets.retirement).toEqual([2040, 2076]);
  });

  it("with retirement year at planStart: working = null, retirement = full", () => {
    const presets = computePresets(2026, 2076, 2026);
    expect(presets.working).toBeNull();
    expect(presets.retirement).toEqual([2026, 2076]);
  });

  it("with retirement year before planStart: working = null, retirement = full", () => {
    const presets = computePresets(2026, 2076, 2020);
    expect(presets.working).toBeNull();
    expect(presets.retirement).toEqual([2026, 2076]);
  });

  it("with retirement year after planEnd: working = full, retirement = null", () => {
    const presets = computePresets(2026, 2076, 2090);
    expect(presets.working).toEqual([2026, 2076]);
    expect(presets.retirement).toBeNull();
  });

  it("with retirement year at planEnd: working ends planEnd-1, retirement = [planEnd, planEnd]", () => {
    const presets = computePresets(2026, 2076, 2076);
    expect(presets.working).toEqual([2026, 2075]);
    expect(presets.retirement).toEqual([2076, 2076]);
  });

  it("with null retirement year: both working and retirement are null", () => {
    const presets = computePresets(2026, 2076, null);
    expect(presets.working).toBeNull();
    expect(presets.retirement).toBeNull();
    expect(presets.full).toEqual([2026, 2076]);
  });

  it("for 1-year projection: full = [year, year]; working/retirement null when no retirement", () => {
    const presets = computePresets(2026, 2026, null);
    expect(presets.full).toEqual([2026, 2026]);
    expect(presets.working).toBeNull();
    expect(presets.retirement).toBeNull();
  });
});

describe("isPresetActive", () => {
  it("returns true on exact match", () => {
    expect(isPresetActive([2026, 2076], [2026, 2076])).toBe(true);
  });

  it("returns false when from differs", () => {
    expect(isPresetActive([2027, 2076], [2026, 2076])).toBe(false);
  });

  it("returns false when to differs", () => {
    expect(isPresetActive([2026, 2075], [2026, 2076])).toBe(false);
  });

  it("returns false when preset is null", () => {
    expect(isPresetActive([2026, 2076], null)).toBe(false);
  });
});

describe("clampRange", () => {
  it("returns range unchanged when within bounds", () => {
    expect(clampRange([2030, 2050], 2026, 2076)).toEqual([2030, 2050]);
  });

  it("clamps from up to min when below", () => {
    expect(clampRange([2020, 2050], 2026, 2076)).toEqual([2026, 2050]);
  });

  it("clamps to down to max when above", () => {
    expect(clampRange([2030, 2080], 2026, 2076)).toEqual([2030, 2076]);
  });

  it("swaps when from > to (defensive)", () => {
    expect(clampRange([2050, 2030], 2026, 2076)).toEqual([2030, 2050]);
  });

  it("preserves a collapsed range (from === to)", () => {
    expect(clampRange([2050, 2050], 2026, 2076)).toEqual([2050, 2050]);
  });

  it("returns [min, min] when both equal min", () => {
    expect(clampRange([2026, 2026], 2026, 2076)).toEqual([2026, 2026]);
  });
});

describe("computeAxisLabels", () => {
  it("returns 8 labels for a 50-year span by default", () => {
    const labels = computeAxisLabels(2026, 2076);
    expect(labels).toHaveLength(8);
    expect(labels[0]).toBe(2026);
    expect(labels[labels.length - 1]).toBe(2076);
  });

  it("returns labels in monotonically increasing order", () => {
    const labels = computeAxisLabels(2026, 2076);
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i]).toBeGreaterThan(labels[i - 1]);
    }
  });

  it("returns deduped labels for short spans", () => {
    const labels = computeAxisLabels(2026, 2030);
    expect(labels).toEqual([2026, 2027, 2028, 2029, 2030]);
  });

  it("returns single label for 1-year span", () => {
    const labels = computeAxisLabels(2026, 2026);
    expect(labels).toEqual([2026]);
  });

  it("honors custom targetCount", () => {
    const labels = computeAxisLabels(2026, 2076, 5);
    expect(labels).toHaveLength(5);
    expect(labels[0]).toBe(2026);
    expect(labels[4]).toBe(2076);
  });

  it("always includes both endpoints exactly", () => {
    const labels = computeAxisLabels(2030, 2070, 6);
    expect(labels[0]).toBe(2030);
    expect(labels[labels.length - 1]).toBe(2070);
  });
});
