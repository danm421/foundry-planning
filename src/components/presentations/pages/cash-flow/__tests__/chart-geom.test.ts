import { describe, it, expect } from "vitest";
import { scaleLinear } from "d3-scale";
import { stackRects } from "../chart-geom";

describe("stackRects", () => {
  const y = scaleLinear().domain([0, 100]).range([100, 0]);

  it("stacks positive segments upward from zero", () => {
    const rects = stackRects((v) => y(v), [10, 20]);
    expect(rects[0]).toEqual({ y: y(10), height: 10 });
    expect(rects[1]).toEqual({ y: y(30), height: 20 });
  });

  it("stacks negative segments downward from zero, independent of positives", () => {
    const yd = scaleLinear().domain([-100, 100]).range([200, 0]);
    const rects = stackRects((v) => yd(v), [50, -60]);
    // Positive sits above the zero line (smaller pixel y); negative below it.
    expect(rects[0].y).toBeLessThan(yd(0));
    expect(rects[1].y).toBeGreaterThanOrEqual(yd(0) - 1e-9);
    expect(rects[0].height).toBeCloseTo(yd(0) - yd(50));
    expect(rects[1].height).toBeCloseTo(yd(-60) - yd(0));
  });
});
