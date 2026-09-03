// src/components/presentations/pages/scenario-comparison/render-smoke.test.tsx
//
// Renders sheet two (and the composed two-sheet page) against REAL
// `buildScenarioComparisonData` output rather than a hand-built page-data
// fixture, so a change to the view model's shape breaks this test the same
// way it would break the real report.
//
// Two assertions go beyond a plain byte-length smoke check. Task 5's review
// flagged that both matrix rules the spec calls binding are trivially
// mutable today and nothing would redden:
//   - a delta cell's colour comes from `direction` (itself derived from the
//     row's `betterIs`), never from the sign of the delta string;
//   - the best cell in a row is marked with a FILL, not a border.
import { describe, it, expect } from "vitest";
import { isValidElement, type ElementType, type ReactElement, type ReactNode } from "react";
import { renderToBuffer, Document, Text, View } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS, PRESENTATION_THEME as T, ZEBRA_FILL } from "@/lib/presentations/theme";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { ChartLegend } from "@/components/presentations/pages/retirement-comparison/chart-legend-pdf";
import { buildScenarioComparisonData } from "@/lib/presentations/pages/scenario-comparison/view-model";
import { SCENARIO_COMPARISON_OPTIONS_DEFAULT } from "@/lib/presentations/pages/scenario-comparison/options-schema";
import type { TradeoffBand } from "@/lib/presentations/pages/scenario-comparison/types";
import { ScenarioComparisonPagePdf } from "./page-pdf";
import { BandPdf } from "./band-pdf";
import { MatrixPdf } from "./matrix-pdf";
import { ComparisonChartPdf } from "./chart-pdf";

/** Every element of `type` in the tree `node` roots, in render order. Same
 *  helper as matrix-geometry.test.tsx's own — this repo duplicates small
 *  test-only tree walkers per file rather than sharing them across suites. */
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

// ---- Fixture: a real view-model build, not a hand-rolled page shape -------
// Adapted from view-model.test.ts's own bundle()/year() helpers, so the tax,
// retirement-row and net-to-heirs plumbing exercised here is the SAME code
// path the real report runs, not a stand-in. Only the fields the page reads
// are populated; the rest is cast, because the page must not depend on shape
// it never touches.

function year(y: number, liquid: number, tax: number) {
  return {
    year: y,
    portfolioAssets: {
      liquidTotal: liquid, cashTotal: 0, retirementTotal: liquid, taxableTotal: 0,
    },
    expenses: { taxes: tax },
    taxResult: {
      flow: { totalFederalTax: tax * 0.75, stateTax: tax * 0.25,
              capitalGainsTax: 0, fica: 0, totalTax: tax },
      income: { grossTotalIncome: tax * 4 },
    },
  } as never;
}

// dateOfBirth + retirementAge lands retirement on 2050, the fixture's first
// projection row — matching view-model.test.ts's own CLIENT fixture.
const CLIENT = {
  firstName: "A", lastName: "B", spouseName: null,
  dateOfBirth: "1988-04-01", retirementAge: 62,
};

function bundle(
  label: string,
  atRetirement: number,
  atEndOfLife: number,
  taxYear1: number,
  taxYear2: number,
  successRate: number,
  maxSpend: number,
) {
  return {
    scenarioLabel: label,
    clientData: { client: { ...CLIENT } },
    projection: { years: [year(2050, atRetirement, taxYear1), year(2075, atEndOfLife, taxYear2)] },
    monteCarlo: { summary: { successRate, ending: { p20: atEndOfLife / 4 } } },
    maxSpend: { realAnnualSpend: maxSpend },
  } as never;
}

function ctx() {
  return {
    clientName: "A B",
    spouseName: null,
    bundlesByRef: {
      // Lower lifetime tax than base ($35K vs $70K) — the fixture the
      // "negative but favourable" delta test below needs.
      base: bundle("Base Case", 2_400_000, 4_800_000, 40_000, 30_000, 0.73, 92_000),
      "scenario:s1": bundle("Retire at 62", 2_100_000, 4_200_000, 20_000, 15_000, 0.82, 214_000),
      // Highest end-of-life assets of all four columns — the fill-vs-border
      // test below needs the best cell to land on a non-Base-Case column.
      "scenario:s2": bundle("Sell the condo", 2_600_000, 5_500_000, 45_000, 35_000, 0.65, 150_000),
      "scenario:s3": bundle("Move to Texas", 2_300_000, 4_100_000, 42_000, 32_000, 0.88, 175_000),
    },
  } as never;
}

const data = buildScenarioComparisonData(ctx(), {
  ...SCENARIO_COMPARISON_OPTIONS_DEFAULT,
  scenarioIds: ["s1", "s2", "s3"],
  ai: {
    ...SCENARIO_COMPARISON_OPTIONS_DEFAULT.ai,
    byScenario: {
      s1: {
        generatedText:
          "Retiring at 62 raises plan confidence from 73% to 82% and cuts lifetime taxes by $35K. " +
          "The tradeoff is a smaller ending balance than staying the course.",
        generatedAt: "2026-01-01T00:00:00Z",
        sourceHash: "abc123",
      },
    },
  },
});

const emptyData = buildScenarioComparisonData(ctx(), SCENARIO_COMPARISON_OPTIONS_DEFAULT);

// Same three scenarios as `data`, but with the tradeoff bands turned off —
// `data.bands` comes back `[]` (view-model.test.ts pins this), and sheet two
// must not print a section head over blank space for it (T6-I1).
const noBandsData = buildScenarioComparisonData(ctx(), {
  ...SCENARIO_COMPARISON_OPTIONS_DEFAULT,
  scenarioIds: ["s1", "s2", "s3"],
  showTradeoffBands: false,
});

const baseInput = {
  firmName: "Ethos Financial Group",
  clientName: "A B",
  reportDate: "January 1, 2026",
  totalPages: 5,
  accent: SECTION_ACCENTS.Comparison,
};

describe("ScenarioComparisonPagePdf render", () => {
  it("renders the empty state without throwing, as exactly one PageFrame", async () => {
    ensureFontsRegistered();
    expect(emptyData.isEmpty).toBe(true); // guard: proves this really is the empty path
    const tree = ScenarioComparisonPagePdf({ data: emptyData, pageIndex: 1, ...baseInput });
    expect(collect(tree, PageFrame)).toHaveLength(1);
    const buf = await renderToBuffer(<Document>{tree}</Document>);
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it("renders three-scenario data without throwing, as exactly two PageFrames", async () => {
    ensureFontsRegistered();
    expect(data.isEmpty).toBe(false); // guard
    expect(data.bands).toHaveLength(3); // guard
    const tree = ScenarioComparisonPagePdf({ data, pageIndex: 1, ...baseInput });
    expect(collect(tree, PageFrame)).toHaveLength(2);
    const buf = await renderToBuffer(<Document>{tree}</Document>);
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  // T6-I1: with `showTradeoffBands` off, sheet two has nothing to say — a
  // section head and a footer over blank space — so the composer must omit
  // it, and `estimateScenarioComparisonPageCount` must agree (covered in
  // view-model.test.ts's "omits the bands when the option is off").
  it("omits sheet two — and prints only one PageFrame — when showTradeoffBands is off", async () => {
    ensureFontsRegistered();
    expect(noBandsData.isEmpty).toBe(false); // guard: scenarios ARE chosen
    expect(noBandsData.bands).toEqual([]); // guard: bands really are empty
    const tree = ScenarioComparisonPagePdf({ data: noBandsData, pageIndex: 1, ...baseInput });
    expect(collect(tree, PageFrame)).toHaveLength(1);
    const buf = await renderToBuffer(<Document>{tree}</Document>);
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});

describe("sheet two — tradeoff bands", () => {
  // T6-I2: calling `BandPdf({ band })` directly only proves the leaf
  // component prints a name — it says nothing about whether `page-pdf.tsx`
  // actually puts it on the page. Walking the COMPOSED tree instead means
  // deleting `<BandPdf band={b} />` from page-pdf.tsx turns this red (verified
  // by mutation, see task-6-report.md).
  it("puts every band's scenario name on the COMPOSED page", () => {
    const tree = ScenarioComparisonPagePdf({ data, pageIndex: 1, ...baseInput });
    const bandEls = collect(tree, BandPdf);

    // Guard: one BandPdf per band, in the same order — proves the composer
    // wires page-pdf.tsx's real `data.bands` into sheet two, not a stand-in.
    expect(bandEls.map((el) => (el.props as { band: TradeoffBand }).band.name))
      .toEqual(data.bands.map((b) => b.name));

    // Expand each composed BandPdf element for real and confirm the name is
    // actually painted, not just that a correctly-propped element exists.
    for (const el of bandEls) {
      const props = el.props as Parameters<typeof BandPdf>[0];
      const texts = collect(BandPdf(props), Text)
        .map((t) => (t.props as { children?: ReactNode }).children);
      expect(texts, props.band.scenarioId).toContain(props.band.name);
    }
  });
});

describe("chart legend", () => {
  it("renders one legend item per column", () => {
    expect(data.chart).not.toBeNull();
    const legends = collect(ComparisonChartPdf({ spec: data.chart! }), ChartLegend);
    expect(legends).toHaveLength(1);
    const items = (legends[0].props as { items: { label: string }[] }).items;
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.label)).toEqual(data.columns.map((c) => c.name));
  });
});

describe("matrix — binding rules the spec calls out (Task 5 review)", () => {
  it("colours a negative-but-favourable delta from `direction`, never from the delta's sign", () => {
    const row = data.rows.find((r) => r.label === "Lifetime taxes — total")!;
    const col = data.columns.findIndex((c) => c.refKey === "s1");
    const cell = row.cells[col];

    // Guard on the fixture: s1's delta must actually be negative-signed AND
    // favourable, or the assertion below would pass without exercising the
    // bug the brief flagged (colour keyed to the sign instead of `betterIs`).
    expect(cell.delta).toMatch(/^−/);
    expect(cell.direction).toBe(1);

    // Render just this one row in isolation so the delta string can't
    // collide with another row's cell.
    const texts = collect(MatrixPdf({ columns: data.columns, rows: [row] }), Text);
    const deltaText = texts.find((t) => (t.props as { children?: ReactNode }).children === cell.delta);
    expect(deltaText).toBeDefined();

    const style = (deltaText!.props as { style: Array<Record<string, unknown>> }).style;
    const colorStyle = style.find((st) => "color" in st);
    expect(colorStyle?.color).toBe(T.good);
  });

  it("marks the best cell in a row with a fill, not a border", () => {
    const row = data.rows.find((r) => r.label === "Assets end of life")!;
    const bestIdx = row.cells.findIndex((c) => c.isBest);

    // Guard on the fixture: a scenario, not Base Case, must win this row —
    // otherwise the style check below could pass on an entirely unstyled cell.
    expect(bestIdx).toBeGreaterThan(0);

    const cellViews = collect(MatrixPdf({ columns: data.columns, rows: [row] }), View)
      .filter((v) => Array.isArray((v.props as { style?: unknown }).style));
    expect(cellViews).toHaveLength(row.cells.length);

    const merged = Object.assign(
      {},
      ...(cellViews[bestIdx].props as { style: Array<Record<string, unknown>> }).style,
    ) as Record<string, unknown>;
    expect(merged.backgroundColor).toBe(ZEBRA_FILL);
    expect(merged.borderWidth).toBeUndefined();
    expect(merged.borderColor).toBeUndefined();
  });
});
