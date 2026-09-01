// Do the chart's y-axis tick labels stay out of the plot?
//
// Nothing else in the suite can answer that. The spec tests assert the tick
// VALUES; tsc and eslint see JSX; the render smokes assert a byte length. The
// labels shipped with SVG's default `start` anchor, so each one began 6pt left
// of the plot and ran rightward THROUGH it — on the live Sheskier deck "$200k"
// printed across the first two bars on every cash-flow sheet, past four
// separate reviews, and the only instrument that saw it was a human looking at
// a 300dpi crop.
//
// So: render the real component from specs the REAL builders produce, and
// measure the actual glyph boxes with `pdftotext -bbox`. The plot origin comes
// from the same `spec.margin.left` the component lays out with, so guard and
// chart cannot drift. The page offset cancels — a label and the plot it must
// clear move together — so the chart is measured on a bare, unpadded sheet.
//
// Needs poppler on PATH (`brew install poppler`), same as
// `kpi-strip-geometry.test.tsx`. It says so rather than skipping: a measurement
// that quietly opts out is worse than one that is absent.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document, Page } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { wordBoxes, BBOX_EPS as EPS } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { buildCashFlowChartSpec } from "@/lib/presentations/charts/cashflow-chart-spec";
import { buildDrillChartSpec } from "@/lib/presentations/shared/build-chart-spec";
import { dataLight } from "@/brand";
import type { ChartSpec } from "@/lib/presentations/charts/types";
import type { CashFlowTableRow } from "@/lib/presentations/types";
import { CashflowChartPdf } from "./chart-pdf";

/** Render the chart alone on an unpadded sheet, so page coordinates ARE the
 *  chart's own SVG coordinates and the plot origin is `spec.margin.left`. */
async function tickLabels(spec: ChartSpec) {
  ensureFontsRegistered();
  const pdf = await renderToBuffer(
    <Document>
      <Page size={[spec.width, spec.height]} style={{ padding: 0 }}>
        <CashflowChartPdf spec={spec} />
      </Page>
    </Document>,
  );
  const words = wordBoxes(pdf, 1);
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
    assertClearOfThePlot(spec, await tickLabels(spec));
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
    assertClearOfThePlot(spec, await tickLabels(spec));
  }, 30_000);
});
