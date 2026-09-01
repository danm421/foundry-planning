// Do the risk/return scatter's axis labels land where they claim to?
//
// Third of this family, after `pages/cash-flow` and `pages/monte-carlo/charts`,
// and it exists because this chart shipped the same two defects verbatim:
//
//   · every y-axis tick was drawn at `x={-6}` with SVG's default `start` anchor,
//     so it began 6pt left of the plot and ran rightward THROUGH it — measured
//     on a real prod deck at 2.56pt into the plot for a two-character label and
//     6.76pt for a three-character one, across the leftmost gridline;
//   · every x-axis tick was drawn AT its gridline and left-anchored, so it ran
//     right from there and put its own centre 4.24-6.50pt on — those look fine
//     and simply name a value the gridline is not at.
//
// `ScatterPdf` is drawn by TWO page families from TWO different builders, and
// they do not share a spec: Portfolio Analysis is `buildScatterSpec` (360pt
// wide, 52pt gutter, ticks snapped to whole percents), the Investment Proposal's
// risk-and-return section is `buildProposalScatterSpec` (430pt wide, 46pt
// gutter, ticks at raw quarter-domain floats). A right-anchored label grows INTO
// the gutter, so the narrower one is a different question, not the same one
// twice — both are measured.
//
// The mechanics live in `shared/test-utils/axis-geometry`; see the note there on
// why the cash-flow guard keeps its own lenient variant. The plot origin and the
// tick positions come from the same `spec.margin` and `scatterGeom` scales the
// component lays out with, so guard and chart cannot drift.
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
  CENTRE_EPS,
  BBOX_EPS as EPS,
} from "@/components/presentations/shared/test-utils/axis-geometry";
import { buildScatterSpec } from "@/lib/presentations/charts/scatter-chart-spec";
import { buildProposalScatterSpec } from "@/lib/presentations/pages/investment-proposal/charts";
import type { ScatterSpec } from "@/lib/presentations/charts/types";
import type { AnalysisRow, EntityType } from "@/lib/investments/portfolio-analysis";
import { ScatterPdf, scatterGeom } from "../scatter-pdf";

const row = (key: string, type: EntityType, name: string, mean: number, sd: number): AnalysisRow => ({
  key,
  type,
  id: key,
  name,
  weights: [],
  value: null,
  residualUnallocatedPct: 0,
  stats: { arithmeticMean: mean, geometricReturn: mean - 0.01, stdDev: sd, sharpe: 0.3 },
});

/** ⚠️ Both axes format with the SAME `pct`, on both builders, so a fixture whose
 *  domains overlap prints one label twice and no measurement below identifies a
 *  single label. The proposal builder can also print a duplicate WITHIN one
 *  axis: its ticks are raw quarter-domain floats and `pct` rounds them to whole
 *  percents, so a narrow domain collapses two ticks onto one string. Both are
 *  checked before anything is measured, so a fixture that drifts into either
 *  fails saying so rather than failing somewhere confusing. */
function assertLabelsIdentify(spec: ScatterSpec) {
  const y = spec.yAxis.ticks.map(spec.yAxis.labelFormat);
  const x = spec.xAxis.ticks.map(spec.xAxis.labelFormat);
  expect(new Set(y).size, `y ticks print a duplicate label: ${y.join(", ")}`).toBe(y.length);
  expect(new Set(x).size, `x ticks print a duplicate label: ${x.join(", ")}`).toBe(x.length);
  expect(y.filter((l) => x.includes(l)), "the same label is printed on both axes").toEqual([]);
  return { yLabels: y, xLabels: x };
}

/** The whole battery for one scatter spec: the gutter, the tick centring, and
 *  both titles. Shared because the two builders differ in size and gutter but
 *  not in what "right" means. */
async function measureScatter(spec: ScatterSpec) {
  const { yLabels } = assertLabelsIdentify(spec);
  const { innerW, innerH, x } = scatterGeom(spec);
  const words = await renderChartWords(spec, <ScatterPdf spec={spec} />);

  assertGutterHolds(spec, words, yLabels);

  expect(spec.xAxis.ticks.length, "fixture produced no x-axis ticks to measure").toBeGreaterThan(3);
  assertCentred(
    spec,
    spec.xAxis.ticks.map((t) => ({
      what: `x-axis tick "${spec.xAxis.labelFormat(t)}"`,
      centre: spec.margin.left + x(t),
      b: labelBox(words, spec.xAxis.labelFormat(t)),
    })),
    x(spec.xAxis.ticks[1]) - x(spec.xAxis.ticks[0]),
  );

  // Both axis titles were already centred — but with `textAnchor` inside
  // `style`, which @react-pdf honours and a reviewer's grep does not. They now
  // say so on the prop, and this is the evidence that the move changed nothing.
  const run = spec.xAxis.title.split(" ").map((w) => labelBox(words, w));
  const runCentre = (Math.min(...run.map((b) => b.xMin)) + Math.max(...run.map((b) => b.xMax))) / 2;
  const plotCentre = spec.margin.left + innerW / 2;
  expect(
    Math.abs(runCentre - plotCentre) <= CENTRE_EPS,
    `x-axis title "${spec.xAxis.title}" centres at ${runCentre.toFixed(2)}pt, not the plot's ${plotCentre.toFixed(2)}pt`,
  ).toBe(true);

  // The y title is rotated upright, so its anchor acts along the PAGE'S Y — the
  // axis it now runs on — and a check on its x extent is blind to it. Measured:
  // anchored it centres on the plot's vertical middle exactly; unanchored it
  // runs upward from the same point and sits 12.45pt high, half its own height.
  // So both are asserted, on the axis each one is about.
  const yRun = spec.yAxis.title.split(" ").map((w) => labelBox(words, w));
  const yCentre = (Math.min(...yRun.map((b) => b.yMin)) + Math.max(...yRun.map((b) => b.yMax))) / 2;
  const plotMiddle = spec.margin.top + innerH / 2;
  expect(
    Math.abs(yCentre - plotMiddle) <= CENTRE_EPS,
    `y-axis title "${spec.yAxis.title}" centres at ${yCentre.toFixed(2)}pt down the page, not the plot's ${plotMiddle.toFixed(2)}pt`,
  ).toBe(true);
  expect(
    Math.max(...yRun.map((b) => b.xMax)) <= spec.margin.left + EPS,
    `y-axis title "${spec.yAxis.title}" reaches past the plot origin (${spec.margin.left}pt)`,
  ).toBe(true);
}

describe("portfolio-analysis scatter geometry", () => {
  it("keeps every y-axis tick in the gutter and centres each x tick on its gridline", async () => {
    // Shaped like a real analysis: a few entity types at plausible risk/return,
    // so `buildScatterSpec` picks its own domains and ticks rather than being
    // handed them.
    await measureScatter(buildScatterSpec([
      row("asset_class:eq", "asset_class", "US Equity", 0.028, 0.21),
      row("account:a1", "account", "Brokerage", 0.021, 0.17),
      row("category:c1", "category", "Taxable", 0.012, 0.13),
    ]));
  }, 30_000);

  it("holds the gutter when the y axis prints its widest label", async () => {
    // `pct` rounds to whole percents, so the widest thing this axis can print is
    // a three-digit return — "100%". Without this case the fixture above tops
    // out at two characters and the 52pt gutter could be cut by half with every
    // test still green.
    const spec = buildScatterSpec([
      row("asset_class:agg", "asset_class", "Aggressive", 1.0, 0.4),
      row("account:a1", "account", "Brokerage", 0.9, 0.3),
    ]);
    const yLabels = spec.yAxis.ticks.map(spec.yAxis.labelFormat);
    expect(
      Math.max(...yLabels.map((l) => l.length)),
      `fixture's widest y label was "${yLabels[yLabels.length - 1]}", not the 4 characters "100%" costs`,
    ).toBe(4);
    assertLabelsIdentify(spec);
    assertGutterHolds(spec, await renderChartWords(spec, <ScatterPdf spec={spec} />), yLabels);
  }, 30_000);
});

describe("investment-proposal scatter geometry", () => {
  it("keeps every y-axis tick inside its NARROWER gutter and centres each x tick", async () => {
    // The proposal's own spec: 430pt wide against a 46pt gutter, 6pt tighter
    // than Portfolio Analysis's. A right-anchored label grows leftward into that
    // gutter, so this is the binding case for the anchor, not a repeat.
    const spec = buildProposalScatterSpec(
      { arithmeticMean: 0.021, geometricReturn: 0.018, stdDev: 0.11, sharpe: 0.2 },
      { arithmeticMean: 0.061, geometricReturn: 0.055, stdDev: 0.19, sharpe: 0.3 },
    );
    expect(spec.margin.left, "the proposal's gutter changed; this test exists for its narrowness").toBe(46);
    await measureScatter(spec);
  }, 30_000);
});
