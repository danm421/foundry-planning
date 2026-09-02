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
import { Polyline } from "@react-pdf/renderer";
import { CONTENT_W, LABEL_COL_W, VALUE_COL_W, MAX_COLUMNS } from "./geom";
import { PAGE_WIDTH_PORTRAIT, PAGE_PAD_X } from "@/components/presentations/shared/page-frame";
import { ComparisonChartPdf, polylineRuns } from "./chart-pdf";
import { ChartLegend } from "@/components/presentations/pages/retirement-comparison/chart-legend-pdf";
import {
  buildComparisonChartSpec,
  type ComparisonSeries,
} from "@/lib/presentations/pages/scenario-comparison/chart-spec";
import { COLUMN_COLORS } from "@/lib/presentations/pages/scenario-comparison/view-model";

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

function fixtureSpec() {
  const series: ComparisonSeries[] = ["Base Case", "Retire at 62", "Sell the condo", "Move to Texas"]
    .map((label, i) => ({
      label,
      color: COLUMN_COLORS[i],
      values: YEARS.map((_, k) =>
        i === 2 && k >= SHORT_YEARS ? NaN : 1_000_000 * (1 + k / 10) * (1 + i / 20),
      ),
      retirementYear: 2036,
    }));
  return buildComparisonChartSpec(YEARS, series, 526, 190);
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
