// Do the life-insurance need chart's axis labels land where they claim to?
//
// This chart carried a lookalike of the anchor defect the cash-flow and Monte
// Carlo charts were fixed for, and a nastier one: its year labels asked to be
// centred with `textAlign: "center"` inside `style`, and @react-pdf IGNORES
// `textAlign` on an SvgText outright. So the years kept SVG's default `start`
// anchor and ran right from the bar's midpoint — measured here at +8.03pt on a
// 13.49pt band, 0.60 of a step, which puts the label over the NEXT bar — while
// a grep for the anchor fix scored the file compliant.
//
// `textAnchor` inside `style` DOES work; only `textAlign` is inert. Both were
// probed directly. The fix uses the prop anyway, the way the y ticks beside it
// already did, so every anchor in this subsystem reads the same way.
//
// The mechanics live in `shared/test-utils/axis-geometry`; see the note there on
// why the cash-flow guard keeps its own lenient variant. Layout comes from the
// same `LI_CHART_BOX` and `liChartGeom` the component draws with, so guard and
// chart cannot drift.
//
// ⚠️ The fixture is hand-built rather than produced by a builder: `LiChart` is
// assembled inline inside `buildLifeInsuranceSummaryData` from a full solve
// payload, with no smaller seam to call. The shape is narrow and typed, so the
// exposure is that a field could change meaning without this noticing — not that
// it could change shape.
//
// Needs poppler on PATH (`brew install poppler`). It says so rather than
// skipping: a measurement that quietly opts out is worse than one that is
// absent, because the suite goes on reporting green.
import { describe, it, expect } from "vitest";
import {
  renderChartWords,
  labelBox,
  assertGutterHolds,
  assertCentred,
  BBOX_EPS as EPS,
} from "@/components/presentations/shared/test-utils/axis-geometry";
import { fmtUsd } from "@/lib/presentations/pages/life-insurance-summary/aggregate";
import type { LiChart } from "@/lib/presentations/pages/life-insurance-summary/view-model";
import { LiNeedChartPdf, liChartGeom, LI_CHART_BOX } from "../chart-pdf";

/** A solved need curve: a married client's need declining as the mortgage
 *  amortises and the kids age out, which is the shape a real solve produces. */
function needChart(years: number, peak: number): LiChart {
  return {
    rows: Array.from({ length: years }, (_, i) => ({
      year: 2026 + i,
      clientNeed: Math.max(0, peak - i * (peak / years)),
      spouseNeed: Math.max(0, peak * 0.375 - i * (peak * 0.011)),
    })),
    markYear: 2044,
    clientCoverageLine: peak * 0.625,
    spouseCoverageLine: peak * 0.2,
  };
}

/** Every label the chart draws down the y axis and along the x axis, checked for
 *  the collisions that would make a measurement ambiguous before it is taken. */
function labelsOf(chart: LiChart, married: boolean) {
  const g = liChartGeom(chart, married);
  const yLabels = g.ticks.map(fmtUsd);
  const drawnYears = g.years.filter((_, i) => i % g.labelStep === 0);
  expect(new Set(yLabels).size, `y ticks print a duplicate label: ${yLabels.join(", ")}`).toBe(yLabels.length);
  expect(
    yLabels.filter((l) => drawnYears.map(String).includes(l)),
    "a y tick and an x label print the same text, so no measurement below identifies one label",
  ).toEqual([]);
  return { g, yLabels, drawnYears };
}

describe("life-insurance need chart geometry", () => {
  it("keeps every y-axis tick in the gutter and centres each year on its bar", async () => {
    const chart = needChart(34, 2_400_000);
    const { g, yLabels, drawnYears } = labelsOf(chart, true);
    const words = await renderChartWords(LI_CHART_BOX, <LiNeedChartPdf chart={chart} married />);

    assertGutterHolds(LI_CHART_BOX, words, yLabels);

    expect(drawnYears.length, "fixture produced no x labels to measure").toBeGreaterThan(3);
    assertCentred(
      LI_CHART_BOX,
      drawnYears.map((yr) => ({
        what: `x label "${yr}"`,
        centre: LI_CHART_BOX.margin.left + (g.x(yr) ?? 0) + g.band / 2,
        b: labelBox(words, String(yr)),
      })),
      g.x.step(),
    );

    // Centring moves a label BOTH ways, so the one on the first bar grows left
    // toward the y-axis ticks it never used to reach. That collision is the
    // still-open defect on the cash-flow chart's marker labels, so this chart
    // gets measured for it rather than assumed clear: the first year must start
    // after the widest y tick ends.
    const firstYear = labelBox(words, String(drawnYears[0]));
    const gutterEnd = Math.max(...yLabels.map((l) => labelBox(words, l).xMax));
    expect(
      firstYear.xMin >= gutterEnd - EPS,
      `the first x label "${drawnYears[0]}" starts at ${firstYear.xMin.toFixed(2)}pt, `
        + `overprinting the y-axis ticks that run to ${gutterEnd.toFixed(2)}pt`,
    ).toBe(true);
  }, 30_000);

  it("holds the gutter when the y axis prints its widest label", async () => {
    // `fmtUsd` has no billions branch, so a $2B need prints as "$2000.0M" —
    // eight characters into a 44pt gutter. Without this case the fixture above
    // tops out at "$3.5M" and the gutter could be cut by half with every test
    // still green, while a real high-net-worth solve clipped.
    const chart = needChart(34, 2_000_000_000);
    const { yLabels } = labelsOf(chart, true);
    expect(
      Math.max(...yLabels.map((l) => l.length)),
      `fixture's widest label was "${yLabels[yLabels.length - 1]}", not the 8 characters fmtUsd can print`,
    ).toBe(8);
    assertGutterHolds(
      LI_CHART_BOX,
      await renderChartWords(LI_CHART_BOX, <LiNeedChartPdf chart={chart} married />),
      yLabels,
    );
  }, 30_000);

  it("centres each year on its bar for a single client, where the bars are unstacked", async () => {
    // `married: false` zeroes every spouse need, which changes the y domain and
    // so the gutter's label widths. The x geometry is independent of it — this
    // is the case that says so rather than leaving it assumed.
    const chart = needChart(28, 1_600_000);
    const { g, yLabels, drawnYears } = labelsOf(chart, false);
    const words = await renderChartWords(LI_CHART_BOX, <LiNeedChartPdf chart={chart} married={false} />);

    assertGutterHolds(LI_CHART_BOX, words, yLabels);
    assertCentred(
      LI_CHART_BOX,
      drawnYears.map((yr) => ({
        what: `x label "${yr}"`,
        centre: LI_CHART_BOX.margin.left + (g.x(yr) ?? 0) + g.band / 2,
        b: labelBox(words, String(yr)),
      })),
      g.x.step(),
    );
  }, 30_000);
});
