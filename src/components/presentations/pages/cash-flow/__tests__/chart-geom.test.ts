import { describe, it, expect } from "vitest";
import { scaleLinear } from "d3-scale";
import {
  LEGEND_LABEL_X,
  LEGEND_MIN_ITEM_W,
  legendLayout,
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

describe("legend layout", () => {
  // The two canvases the deck actually draws on. Both put the legend at the
  // left margin, so the room it has is the plot width.
  const DECK = { width: 540, left: 64, right: 16 };
  const RETIREMENT_PANEL = { width: 500, left: 64, right: 16 };
  const inner = (c: typeof DECK) => c.width - c.left - c.right;

  // The widest label any of these charts prints, at 7pt Inter. Measured
  // generously: 7pt Inter averages well under 4pt per character.
  const WIDEST_LABEL_PT = "Social Security".length * 4;

  it("lays the first row out left to right at an even pitch", () => {
    const layout = legendLayout(6, inner(DECK));
    expect(legendSlot(0, layout)).toEqual({ x: 0, y: 0 });
    expect(legendSlot(1, layout)).toEqual({ x: layout.itemW, y: 0 });
  });

  // The failure this guards is silent: an @react-pdf Svg child placed past the
  // right edge is simply not drawn, and the series it names loses its label
  // with no error. The old guard checked the item's ORIGIN was on canvas, which
  // is why "Total Exper" printed for years — the origin fit, the text did not.
  it.each([
    ["the 540pt deck chart", DECK],
    ["the 500pt retirement panel", RETIREMENT_PANEL],
  ])("keeps every LABEL of a six-item legend inside %s", (_name, canvas) => {
    const layout = legendLayout(6, inner(canvas));
    for (let i = 0; i < 6; i++) {
      const labelEnd =
        canvas.left + legendSlot(i, layout).x + LEGEND_LABEL_X + WIDEST_LABEL_PT;
      expect(labelEnd).toBeLessThanOrEqual(canvas.width);
    }
  });

  it("wraps rather than running a row past the edge", () => {
    const layout = legendLayout(7, inner(DECK));
    expect(layout.perRow).toBeLessThan(7);
    const wrapped = legendSlot(layout.perRow, layout);
    expect(wrapped.x).toBe(0);
    expect(wrapped.y).toBeGreaterThan(0);
  });

  it("never pitches an item tighter than a label needs", () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 12]) {
      const layout = legendLayout(count, inner(DECK));
      expect(layout.itemW).toBeGreaterThanOrEqual(LEGEND_MIN_ITEM_W);
    }
  });

  it("keeps a wrapped legend inside the bottom margin it already occupies", () => {
    // Legend origin is `height - margin.bottom + 28`; the shortest chart in the
    // deck is the 175pt month chart with a 56pt bottom margin.
    const height = 175;
    const marginBottom = 56;
    const originY = height - marginBottom + 28;
    const layout = legendLayout(8, inner(DECK));
    expect(originY + legendSlot(7, layout).y).toBeLessThanOrEqual(height);
  });

  it("still places a single item when the canvas is narrower than one slot", () => {
    const layout = legendLayout(3, 40);
    expect(layout.perRow).toBe(1);
    expect(legendSlot(2, layout).y).toBeGreaterThan(0);
  });
});
