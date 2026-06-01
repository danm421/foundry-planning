import { describe, it, expect } from "vitest";
import { chartSeriesColors } from "./chart-palette";

describe("chartSeriesColors", () => {
  it("returns named-palette hex for n<=9, ordered for adjacency", () => {
    const c = chartSeriesColors(3, "dark");
    expect(c).toEqual(["#f0824e", "#2fd498", "#ecc659"]); // terra, emerald, wheat
  });
  it("uses light hex in light theme", () => {
    expect(chartSeriesColors(1, "light")[0]).toBe("#cf6233"); // light terra
  });
  it("falls back to dataScale for n>9", () => {
    const c = chartSeriesColors(12, "dark");
    expect(c).toHaveLength(12);
    expect(c.slice(9).every((x) => x.startsWith("oklch("))).toBe(true);
  });
});
