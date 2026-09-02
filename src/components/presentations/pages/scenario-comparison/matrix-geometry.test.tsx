// Two things nothing else in the suite can answer.
//
// 1. Does the matrix fill the box the deck actually prints? The column widths
//    are hand-picked, and a column that overflows the content box is clipped by
//    the page, not reported. The frame's own constants are read here rather than
//    restated — a guard that hand-builds its own page spec measures a page the
//    product never prints.
//
// 2. Does a plan that ends early stop being drawn? `ChartSpec.lines[].values` is
//    `number[]` with no null channel, so `chart-spec.ts` writes `NaN` for the
//    years past a plan's end. The cash-flow renderer joins every point into ONE
//    polyline, and `y(NaN)` is `NaN`, so following it would put the literal
//    token `"481,NaN"` into the points attribute and corrupt the whole line.
//    tsc and eslint see well-formed JSX; a render smoke asserts a byte length.
import { describe, it, expect } from "vitest";
import { isValidElement, type ElementType, type ReactElement, type ReactNode } from "react";
import { Polyline, Text as SvgText } from "@react-pdf/renderer";
import { CONTENT_W, LABEL_COL_W, VALUE_COL_W, MAX_COLUMNS } from "./geom";
import { PAGE_WIDTH_PORTRAIT, PAGE_PAD_X } from "@/components/presentations/shared/page-frame";
import { ComparisonChartPdf, polylineRuns } from "./chart-pdf";
import { ChartLegend } from "@/components/presentations/pages/retirement-comparison/chart-legend-pdf";
import {
  buildComparisonChartSpec,
  type ComparisonSeries,
} from "@/lib/presentations/pages/scenario-comparison/chart-spec";
import {
  MARKER_LABEL_ROW_H,
  MARKER_LABEL_INK_EM,
} from "@/components/presentations/pages/cash-flow/chart-geom";
import { COLUMN_COLORS, CHART_HEIGHT } from "@/lib/presentations/pages/scenario-comparison/view-model";

describe("scenario comparison column geometry", () => {
  it("derives the content width from the frame the deck actually prints", () => {
    expect(CONTENT_W).toBe(PAGE_WIDTH_PORTRAIT - 2 * PAGE_PAD_X);
  });

  it("fills the content box exactly at four columns", () => {
    expect(LABEL_COL_W + MAX_COLUMNS * VALUE_COL_W).toBe(CONTENT_W);
  });
});

describe("polylineRuns — the gap contract", () => {
  it("draws one unbroken run when every point is finite", () => {
    expect(polylineRuns([{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }]))
      .toEqual(["0,1 1,2 2,3"]);
  });

  it("breaks the line on a non-finite value instead of writing it into the points", () => {
    const runs = polylineRuns([
      { x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: NaN }, { x: 3, y: 4 }, { x: 4, y: 5 },
    ]);
    expect(runs).toEqual(["0,1 1,2", "3,4 4,5"]);
    expect(runs.join(" ")).not.toContain("NaN");
  });

  it("the single joined polyline it replaces would carry the NaN token", () => {
    const points = [{ x: 0, y: 1 }, { x: 1, y: NaN }, { x: 2, y: 3 }];
    // What `cash-flow/chart-pdf.tsx` does, and why this renderer cannot.
    expect(points.map((p) => `${p.x},${p.y}`).join(" ")).toContain("NaN");
    expect(polylineRuns(points).join(" ")).not.toContain("NaN");
  });

  it("simply stops at a plan's last year — no run, and no cliff, past it", () => {
    const runs = polylineRuns([{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: NaN }, { x: 3, y: NaN }]);
    expect(runs).toEqual(["0,1 1,2"]);
  });

  it("breaks on a non-finite x too — an off-domain year has no band to stand on", () => {
    expect(polylineRuns([{ x: 0, y: 1 }, { x: NaN, y: 2 }, { x: 2, y: 3 }]))
      .toEqual(["0,1", "2,3"]);
  });

  it("draws nothing at all when no point is drawable", () => {
    expect(polylineRuns([{ x: 0, y: NaN }, { x: 1, y: NaN }])).toEqual([]);
  });
});

/** Every element of `type` in the tree `node` roots, in render order. */
function collect(node: ReactNode, type: ElementType, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, type, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  if (node.type === type) out.push(node);
  collect((node.props as { children?: ReactNode }).children, type, out);
  return out;
}

const YEARS = Array.from({ length: 20 }, (_, i) => 2026 + i);
/** Column 3 is the short plan: ten real years, then the union's tail as gaps. */
const SHORT_YEARS = 10;
/** What `view-model.ts` asks `buildComparisonChartSpec` for — read from it, not
 *  restated: a guard that hand-picks its own height measures a chart the
 *  product never prints. */
const CHART_H = CHART_HEIGHT;

function fixtureSpec(retirementYears: number[] = [2036, 2036, 2036, 2036]) {
  const series: ComparisonSeries[] = ["Base Case", "Retire at 62", "Sell the condo", "Move to Texas"]
    .map((label, i) => ({
      label,
      color: COLUMN_COLORS[i],
      values: YEARS.map((_, k) =>
        i === 2 && k >= SHORT_YEARS ? NaN : 1_000_000 * (1 + k / 10) * (1 + i / 20),
      ),
      retirementYear: retirementYears[i],
    }));
  return buildComparisonChartSpec(YEARS, series, CONTENT_W, CHART_H);
}

describe("ComparisonChartPdf", () => {
  const spec = fixtureSpec();
  const tree = ComparisonChartPdf({ spec });
  const polylines = collect(tree, Polyline);
  const propsOf = (el: ReactElement) => el.props as { points: string; stroke: string };

  it("emits no NaN token in any points attribute", () => {
    expect(polylines.length).toBeGreaterThan(0);
    for (const p of polylines) expect(propsOf(p).points).not.toContain("NaN");
  });

  it("draws the full-length plans as one run each and the short plan as one short run", () => {
    const runsFor = (color: string) =>
      polylines.filter((p) => propsOf(p).stroke === color).map((p) => propsOf(p).points);

    for (const i of [0, 1, 3]) {
      const runs = runsFor(COLUMN_COLORS[i]);
      expect(runs, `column ${i}`).toHaveLength(1);
      expect(runs[0].split(" "), `column ${i}`).toHaveLength(YEARS.length);
    }

    const short = runsFor(COLUMN_COLORS[2]);
    expect(short).toHaveLength(1);
    expect(short[0].split(" ")).toHaveLength(SHORT_YEARS);
  });

  it("stops the short plan's line short of the plot's right edge", () => {
    const lastX = (color: string) => {
      const runs = polylines.filter((p) => propsOf(p).stroke === color);
      const pts = runs[runs.length - 1].props as { points: string };
      const tail = pts.points.split(" ").pop() ?? "";
      return Number(tail.split(",")[0]);
    };
    expect(lastX(COLUMN_COLORS[2])).toBeLessThan(lastX(COLUMN_COLORS[0]));
  });

  it("hands every legend item to the legend — none is silently dropped", () => {
    const legends = collect(tree, ChartLegend);
    expect(legends).toHaveLength(1);
    const items = (legends[0].props as { items: { label: string }[] }).items;
    expect(items.map((i) => i.label)).toEqual(spec.legend.items.map((i) => i.label));
    expect(items).toHaveLength(4);
  });
});

/**
 * Two retirement labels one band apart — the case `chart-geom.ts` says already
 * shipped in a client deck as "Matt NewnhaCarrie — Retirement".
 *
 * `markerLabelLayout`'s row budget is `floor(margin.top / MARKER_LABEL_ROW_H)`,
 * and its baseline is `MARKER_LABEL_BASE_Y` below the plot's top edge. Both were
 * sized against cash-flow's 24pt top margin. At this chart's original 8pt,
 * `floor(8 / 7.5)` is 1, so a label that cannot fit beside its neighbour is
 * forced back onto row 0 and prints THROUGH it — and the single row it does get
 * sits at 4pt absolute, which shaves the caps off a 6pt label.
 *
 * The arithmetic that picks 17:
 *   · two rows needs `margin.top >= 2 * 7.5` = 15;
 *   · the SECOND row's baseline is `margin.top - 4 - 7.5`, and its ink has to
 *     clear the canvas top, so `margin.top >= 11.5 + 6 * MARKER_LABEL_INK_EM`
 *     = 16.08. That ink figure is MEASURED (two-sheet-geometry.test.tsx); the
 *     4.36pt cap height this originally assumed put the number at 15.86 and
 *     left 16 clipping.
 * 17 is the smallest integer that satisfies both.
 */
/** How far a marker label's ink reaches above its baseline at 6pt. Taken from
 *  the module that owns it and re-measured from a render in
 *  two-sheet-geometry.test.tsx — a hand-copied number in this slot is what let
 *  a clipped label pass. A baseline closer to the canvas top than this shaves
 *  the label's top off: an @react-pdf `Svg` child past the viewport is not
 *  drawn — no error, no clipping artefact. */
const LABEL_CAP_H = 6 * MARKER_LABEL_INK_EM;

describe("retirement marker labels", () => {
  const spec = fixtureSpec([2036, 2036, 2037, 2036]);

  /** The placed marker labels, with `y` lifted into canvas coordinates. */
  const placed = (() => {
    const wanted = new Set(spec.markers.map((m) => m.label));
    return collect(ComparisonChartPdf({ spec }), SvgText)
      .map((el) => el.props as { x: number; y: number; children: unknown })
      .filter((p) => typeof p.children === "string" && wanted.has(p.children))
      .map((p) => ({ label: p.children as string, x: p.x, y: spec.margin.top + p.y }));
  })();

  it("is measuring two labels that really do collide", () => {
    // Guard on the instrument: one marker, or two far apart, would let the
    // stacking assertion below pass without stacking anything.
    expect(placed.map((p) => p.label)).toEqual(["Retires 2036", "Retires 2037"]);
    const halves = spec.markers.map((m) => (m.label.length * 3.35) / 2);
    expect(Math.abs(placed[0].x - placed[1].x)).toBeLessThan(halves[0] + halves[1]);
  });

  it("stacks the colliding label onto a second row instead of printing through", () => {
    expect(placed[0].y).not.toBe(placed[1].y);
    expect(Math.abs(placed[0].y - placed[1].y)).toBe(MARKER_LABEL_ROW_H);
  });

  it("keeps every row's glyphs on the canvas", () => {
    const clipped = placed
      .filter((p) => p.y < LABEL_CAP_H)
      .map((p) => `"${p.label}" baseline ${p.y}pt leaves ${p.y - LABEL_CAP_H}pt of cap off-canvas`);
    expect(clipped).toEqual([]);
  });
});
