import { describe, it, expect } from "vitest";
import { scaleLinear } from "d3-scale";
import {
  LEGEND_ITEM_W,
  LEGEND_PER_ROW,
  legendSlot,
  stackRects,
} from "../chart-geom";

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

describe("legendSlot", () => {
  // The chart canvas is 540pt wide and the legend starts at the left margin
  // (64pt), so the row has 476pt for items pitched 85pt apart.
  const CANVAS_W = 540;
  const LEGEND_LEFT = 64;

  it("lays the first row out left to right", () => {
    expect(legendSlot(0)).toEqual({ x: 0, y: 0 });
    expect(legendSlot(1)).toEqual({ x: LEGEND_ITEM_W, y: 0 });
  });

  it("keeps every item of a full row inside the canvas", () => {
    // The failure this guards is silent: an item placed past the right edge is
    // simply not drawn, and the series it names loses its label with no error.
    for (let i = 0; i < LEGEND_PER_ROW; i++) {
      expect(LEGEND_LEFT + legendSlot(i).x).toBeLessThan(CANVAS_W);
    }
  });

  it("wraps the seventh item onto a second row rather than off the canvas", () => {
    const seventh = legendSlot(LEGEND_PER_ROW);
    expect(seventh.x).toBe(0);
    expect(seventh.y).toBeGreaterThan(0);
    expect(LEGEND_LEFT + seventh.x).toBeLessThan(CANVAS_W);
  });

  it("keeps a wrapped legend inside the bottom margin it already occupies", () => {
    // Legend origin is `height - margin.bottom + 28`; the shortest chart in the
    // deck is the 175pt month chart with a 56pt bottom margin.
    const height = 175;
    const marginBottom = 56;
    const originY = height - marginBottom + 28;
    // Two rows is what seven items need.
    expect(originY + legendSlot(LEGEND_PER_ROW).y).toBeLessThanOrEqual(height);
  });
});
