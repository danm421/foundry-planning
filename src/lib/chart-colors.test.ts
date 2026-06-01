import { describe, it, expect } from "vitest";
import { chartSeriesColors } from "./chart-palette";

describe("chartSeriesColors", () => {
  it("returns named-palette hex for n<=9, ordered for adjacency", () => {
    const c = chartSeriesColors(3, "dark");
    expect(c).toEqual(["#c0392b", "#2c5fa8", "#2a8a5e"]); // red, blue, green
  });
  it("uses light hex in light theme", () => {
    expect(chartSeriesColors(1, "light")[0]).toBe("#c5392b"); // light red
  });
  it("falls back to dataScale for n>9", () => {
    const c = chartSeriesColors(12, "dark");
    expect(c).toHaveLength(12);
    expect(c.slice(9).every((x) => x.startsWith("oklch("))).toBe(true);
  });
});
