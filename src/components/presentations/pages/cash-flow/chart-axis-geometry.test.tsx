// Do the chart's labels land where they claim to?
//
// Nothing else in the suite can answer that. The spec tests assert the tick
// VALUES; tsc and eslint see JSX; the render smokes assert a byte length. Every
// label in this chart shipped with SVG's default `start` anchor, and each kind
// failed differently for it:
//
//   · the y-axis ticks began 6pt left of the plot and ran rightward THROUGH it,
//     so on the live Sheskier deck "$200k" printed across the first two bars of
//     every cash-flow sheet — ugly, and visibly wrong;
//   · the x-axis ticks and the marker labels are drawn AT a bar's centre, so
//     they started there and ran right, putting their own centre about a
//     bar-step on. Those two are worse: nothing looks broken, the chart just
//     names the wrong year.
//
// All three survived four reviews, and the only instrument that ever saw one
// was a human looking at a 300dpi crop.
//
// So: render the real component from specs the REAL builders produce, and
// measure the actual glyph boxes with `pdftotext -bbox`. The plot origin and
// the bar centres come from the same `spec.margin.left` and `bandScale` the
// component lays out with, so guard and chart cannot drift. The page offset
// cancels — a label and the bar it belongs to move together — so the chart is
// measured on a bare, unpadded sheet.
//
// Needs poppler on PATH (`brew install poppler`), same as
// `kpi-strip-geometry.test.tsx`. It says so rather than skipping: a measurement
// that quietly opts out is worse than one that is absent.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document, Page } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { wordBoxes, BBOX_EPS as EPS, type Word } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { buildCashFlowChartSpec } from "@/lib/presentations/charts/cashflow-chart-spec";
import { buildDrillChartSpec } from "@/lib/presentations/shared/build-chart-spec";
import { dataLight } from "@/brand";
import type { ChartSpec } from "@/lib/presentations/charts/types";
import type { CashFlowTableRow, TableMarker } from "@/lib/presentations/types";
import { bandScale } from "./chart-geom";
import { CashflowChartPdf } from "./chart-pdf";

/** Render the chart alone on an unpadded sheet, so page coordinates ARE the
 *  chart's own SVG coordinates and the plot origin is `spec.margin.left`. */
async function renderWords(spec: ChartSpec): Promise<Word[]> {
  ensureFontsRegistered();
  const pdf = await renderToBuffer(
    <Document>
      <Page size={[spec.width, spec.height]} style={{ padding: 0 }}>
        <CashflowChartPdf spec={spec} />
      </Page>
    </Document>,
  );
  return wordBoxes(pdf, 1);
}

function tickLabels(words: Word[], spec: ChartSpec) {
  // The y-axis labels are exactly what the spec says they are, and no other
  // word on the sheet can collide with one: the x-axis row is years or month
  // names and the legend is series prose, while every tick is currency. So the
  // match is required to be UNIQUE rather than filtered to a band — a second
  // hit would mean this is measuring some other text and saying nothing.
  return spec.yAxis.ticks.map((t) => spec.yAxis.labelFormat(t)).map((text) => {
    const hits = words.filter((w) => w.text === text);
    expect(hits.length, `"${text}" matched ${hits.length} words, not 1`).toBeLessThanOrEqual(1);
    return { text, box: hits[0] };
  });
}

function assertClearOfThePlot(spec: ChartSpec, found: Awaited<ReturnType<typeof tickLabels>>) {
  // The instrument has to be shown to be looking at something: an axis whose
  // labels were not located would report a clean chart.
  const missing = found.filter((f) => !f.box).map((f) => f.text);
  expect(missing, "tick labels not found in the render — this guard is measuring nothing").toEqual([]);

  const origin = spec.margin.left;
  const intruding = found
    .filter((f) => f.box && f.box.xMax > origin + EPS)
    .map((f) => `"${f.text}" runs to ${f.box!.xMax.toFixed(1)}pt, ${(f.box!.xMax - origin).toFixed(1)}pt into the plot (origin ${origin}pt)`);
  expect(intruding).toEqual([]);

  // The other wall: right-anchored labels grow leftward, and a label wider than
  // the margin would be clipped at the canvas edge instead of overprinting.
  const clipped = found
    .filter((f) => f.box && f.box.xMin < -EPS)
    .map((f) => `"${f.text}" starts at ${f.box!.xMin.toFixed(1)}pt, off the left edge of the canvas`);
  expect(clipped).toEqual([]);
}

const rows: CashFlowTableRow[] = Array.from({ length: 30 }, (_, i) => ({
  year: 2026 + i,
  ageClient: 60 + i,
  ageSpouse: 58 + i,
  cells: {
    salary: 0, socialSecurity: 30_000, otherInflows: 5_000,
    rmds: 40_000, withdrawals: 40_000 + i * 40_000,
    totalIncome: 115_000, expenses: 130_000, savings: 0, totalExpenses: 130_000,
    netCashFlow: -15_000, portfolioGrowth: 0, portfolioActivity: 0,
    portfolioAssets: 1_400_000,
  },
}));

describe("Cash-flow chart y-axis geometry", () => {
  it("keeps every tick label out of the plot", async () => {
    // The real builder, at a scale that reaches the widest labels the deck
    // prints: "$1.2M" is what overprinted on the live sheet.
    const spec = buildCashFlowChartSpec({ rows, markers: [] });
    expect(spec.yAxis.ticks.map((t) => spec.yAxis.labelFormat(t))).toContain("$1.2M");
    assertClearOfThePlot(spec, tickLabels(await renderWords(spec), spec));
  }, 30_000);

  it("keeps every tick label out of the plot on a diverging axis", async () => {
    // A negative domain is the widest case the axis can produce: the format
    // parenthesises a loss, so "($100k)" is seven characters where the positive
    // labels are five — and those extra two now grow leftward, into the margin.
    const spec = buildDrillChartSpec({
      years: rows.map((r) => r.year),
      stacks: [
        { seriesId: "up", label: "Available", color: dataLight.green,
          values: rows.map(() => 250_000) },
        { seriesId: "down", label: "Overdrawn", color: dataLight.pink,
          values: rows.map((_, i) => (i % 2 ? -120_000 : 0)) },
      ],
      markers: [],
    });
    expect(spec.yAxis.ticks.some((t) => t < 0), "fixture did not produce a diverging axis").toBe(true);
    assertClearOfThePlot(spec, tickLabels(await renderWords(spec), spec));
  }, 30_000);
});

/** How far a label's centre may sit from the bar centre it names. The defects
 *  this catches are half a label wide — measured at 8.4pt on the x-axis and a
 *  full 15.3pt bar-step on a marker — while a correctly anchored label lands
 *  within 0.01pt, so a point is loose enough for glyph side bearings and still
 *  an order of magnitude tighter than the thing it is looking for. */
const CENTRE_EPS = 1;

/** The horizontal extent of one drawn run of text.
 *
 *  `pdftotext` splits on whitespace, so "Rachel & Adam — Retirement" comes back
 *  as four words even though the chart anchors it as one string; the run is
 *  their union. Every word must be found EXACTLY once, which is what stops this
 *  passing vacuously.
 *
 *  On this bare sheet that rule also catches a run pushed off the end of the
 *  chart, because here the sheet IS the SVG viewport and a word past it is
 *  dropped from the render outright. ⚠️ It does not generalise: on a real page
 *  the chart is narrower than the sheet, and a run clipped at the viewport is
 *  still listed in the text layer with its full extent — the ink is gone but
 *  the words are not. Only a raster sees that one; measure_labels.py does. */
function runExtent(words: Word[], label: string): { min: number; max: number } {
  const boxes = label.split(/\s+/).map((token) => {
    const hits = words.filter((w) => w.text === token);
    expect(
      hits.length,
      `"${token}" of "${label}" matched ${hits.length} words on the sheet, not 1`,
    ).toBe(1);
    return hits[0];
  });
  return {
    min: Math.min(...boxes.map((b) => b.xMin)),
    max: Math.max(...boxes.map((b) => b.xMax)),
  };
}

describe("Cash-flow chart label placement", () => {
  it("centres the x-axis ticks and the marker labels on the bars they name", async () => {
    // A joint marker is the widest label the chart prints above the plot, and
    // it is parked mid-domain where the real ones fall: `buildMarkers` puts one
    // at each principal's retirement and end-of-life year.
    const markers: TableMarker[] = [
      { year: 2036, kind: "retirement", who: "joint", label: "Rachel & Adam — Retirement" },
    ];
    const spec = buildCashFlowChartSpec({ rows, markers });
    expect(spec.markers.length, "fixture produced no marker to measure").toBe(1);

    const words = await renderWords(spec);
    // The component's own band scale, so where this guard thinks a bar is and
    // where the chart draws it cannot come apart.
    const bars = bandScale(spec);
    const barCentre = (v: number) => spec.margin.left + (bars(v) ?? 0) + bars.bandwidth() / 2;

    const drawn = [
      ...spec.xAxis.ticks.map((t) => ({
        what: `x-axis tick "${spec.xAxis.labelFormat(t)}"`,
        bar: t,
        extent: runExtent(words, spec.xAxis.labelFormat(t)),
      })),
      ...spec.markers.map((m) => ({
        what: `marker "${m.label}"`,
        bar: m.atX,
        extent: runExtent(words, m.label),
      })),
    ];

    const adrift = drawn
      .map((l) => ({ ...l, off: (l.extent.min + l.extent.max) / 2 - barCentre(l.bar) }))
      .filter((l) => Math.abs(l.off) > CENTRE_EPS)
      .map((l) => `${l.what} is centred ${l.off.toFixed(1)}pt (${(l.off / bars.step()).toFixed(2)} bars) off the bar it names`);
    expect(adrift).toEqual([]);

    // The other wall: a centred label grows BOTH ways, so one on an end bar can
    // reach past the canvas — where, on this sheet, it stops being drawn.
    const offCanvas = drawn
      .filter((l) => l.extent.min < -EPS || l.extent.max > spec.width + EPS)
      .map((l) => `${l.what} spans ${l.extent.min.toFixed(1)}–${l.extent.max.toFixed(1)}pt on a canvas ${spec.width}pt wide`);
    expect(offCanvas).toEqual([]);
  }, 30_000);
});
