import { describe, it, expect } from "vitest";
import { yoyPct, sliceBarWindow } from "../yoy";

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

describe("sliceBarWindow", () => {
  const years = [2024, 2025, 2026, 2027, 2028, 2029, 2030];

  it("returns 2 before, selected, 2 after when fully inside", () => {
    expect(sliceBarWindow(years, 2027)).toEqual([2025, 2026, 2027, 2028, 2029]);
  });

  it("clamps at the start of the range", () => {
    expect(sliceBarWindow(years, 2024)).toEqual([2024, 2025, 2026]);
    expect(sliceBarWindow(years, 2025)).toEqual([2024, 2025, 2026, 2027]);
  });

  it("clamps at the end of the range", () => {
    expect(sliceBarWindow(years, 2030)).toEqual([2028, 2029, 2030]);
    expect(sliceBarWindow(years, 2029)).toEqual([2027, 2028, 2029, 2030]);
  });

  it("handles projections shorter than 5 years (no padding)", () => {
    expect(sliceBarWindow([2024, 2025, 2026], 2025)).toEqual([2024, 2025, 2026]);
    expect(sliceBarWindow([2024], 2024)).toEqual([2024]);
  });

  it("returns empty when selected year is not in the list", () => {
    expect(sliceBarWindow(years, 2099)).toEqual([]);
  });
});
