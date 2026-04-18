import { describe, it, expect } from "vitest";
import { yoyPct, sliceBarAnchors } from "../yoy";

describe("yoyPct", () => {
  it("returns up badge for positive delta", () => {
    expect(yoyPct(1100, 1000)).toEqual({ value: 10, badge: "up" });
  });

  it("returns down badge for negative delta", () => {
    expect(yoyPct(900, 1000)).toEqual({ value: -10, badge: "down" });
  });

  it("returns flat badge within ±0.05% of zero", () => {
    expect(yoyPct(1000.3, 1000)).toEqual({ value: 0.03, badge: "flat" });
  });

  it("returns null when prior is null or undefined (no prior year)", () => {
    expect(yoyPct(1000, null)).toBeNull();
    expect(yoyPct(1000, undefined)).toBeNull();
  });

  it("returns null when prior is zero (avoid divide-by-zero)", () => {
    expect(yoyPct(1000, 0)).toBeNull();
  });
});

describe("sliceBarAnchors", () => {
  const range = (start: number, end: number) =>
    Array.from({ length: end - start + 1 }, (_, i) => start + i);

  it("returns current, +10, +20, and last when projection runs past +20", () => {
    expect(sliceBarAnchors(range(2026, 2055), 2026)).toEqual([2026, 2036, 2046, 2055]);
  });

  it("omits 'last' when last year is exactly +20 (no duplicate)", () => {
    expect(sliceBarAnchors(range(2026, 2046), 2026)).toEqual([2026, 2036, 2046]);
  });

  it("omits 'last' when last year is shorter than +20", () => {
    expect(sliceBarAnchors(range(2026, 2040), 2026)).toEqual([2026, 2036]);
  });

  it("omits +10 and +20 when not in the year range", () => {
    expect(sliceBarAnchors(range(2026, 2030), 2026)).toEqual([2026]);
  });

  it("works when current is mid-projection", () => {
    // current=2040, +10=2050, +20=2060 (not reachable). Last year is 2055,
    // which is not > current+20, so 'last' is not appended.
    expect(sliceBarAnchors(range(2026, 2055), 2040)).toEqual([2040, 2050]);
  });

  it("handles single-year projection", () => {
    expect(sliceBarAnchors([2026], 2026)).toEqual([2026]);
  });

  it("returns empty when years is empty", () => {
    expect(sliceBarAnchors([], 2026)).toEqual([]);
  });

  it("returns empty when current is not in the year list", () => {
    expect(sliceBarAnchors(range(2026, 2055), 2099)).toEqual([]);
  });
});
