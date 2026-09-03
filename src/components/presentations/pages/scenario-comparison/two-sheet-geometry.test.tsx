// The two-sheet promise, measured on a real @react-pdf render.
//
// Everything else in this suite walks the element tree, and the element tree
// cannot see the two things that break this page:
//
//   1. react-pdf auto-breaks a `<Page>` whose content exceeds the content box.
//      `ScenarioComparisonPagePdf` returns two `PageFrame`s and
//      `estimateScenarioComparisonPageCount` says "2", but the deck numbers
//      every later Contents entry from that estimate — so a sheet that breaks
//      in two mis-numbers the rest of the report while every tree assertion
//      stays green. Counting `PageFrame` elements (render-smoke.test.tsx) is
//      blind to it by construction.
//   2. An `Svg` child placed past the viewport is simply not drawn — no error,
//      no clipping artefact. The retirement marker labels sit in `margin.top`
//      with under a point to spare, and only a rendered — and rasterised —
//      sheet says whether they made it onto the canvas. They did not: this
//      guard is what moved `margin.top` from 16 to 17.
//
// The fixture is deliberately MAXIMAL: four columns, four wrapping change lines
// per band plus a "+N more" tail, narratives many times the sentence budget,
// every metric row present, a column with no Monte Carlo run (so the footnote
// prints and a cell shows a dash), and scenario names long enough to wrap the
// cards and the chart legend. Short strings here would let the guard pass while
// the hazard it exists for went untested.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document, Page, Svg, Text as SvgText } from "@react-pdf/renderer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { PAGE_PAD_X } from "@/components/presentations/shared/page-frame";
import {
  MARKER_LABEL_BASE_Y,
  MARKER_LABEL_ROW_H,
  MARKER_LABEL_INK_EM,
} from "@/components/presentations/pages/cash-flow/chart-geom";
import { buildScenarioComparisonData } from "@/lib/presentations/pages/scenario-comparison/view-model";
import { estimateScenarioComparisonPageCount } from "@/lib/presentations/pages/scenario-comparison/estimate-page-count";
import { SCENARIO_COMPARISON_OPTIONS_DEFAULT } from "@/lib/presentations/pages/scenario-comparison/options-schema";
import type { ScenarioComparisonPageData } from "@/lib/presentations/pages/scenario-comparison/types";
import { LABEL_COL_W, VALUE_COL_W, MAX_COLUMNS } from "./geom";
import { ScenarioComparisonPagePdf } from "./page-pdf";

ensureFontsRegistered();

// ── The measuring instruments ───────────────────────────────────────────────

/** The PDF's page-tree node — `<< /Type /Pages /Count n /Kids […] >>`, written
 *  uncompressed by pdfkit. The count react-pdf actually laid out, not the one
 *  the composer asked for. */
function renderedPages(pdf: Buffer): number {
  const match = /\/Type \/Pages\s*\/Count (\d+)/.exec(pdf.toString("latin1"));
  if (!match) throw new Error("no page-tree node in the rendered PDF");
  return Number(match[1]);
}

interface Word {
  text: string;
  sheet: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Every word in the rendered PDF with the box it occupies, via
 * `pdftotext -bbox`. Requires poppler on PATH and says so if it is missing — a
 * measurement that quietly skips itself is worse than one that is absent,
 * because the suite goes on reporting green.
 *
 * ⚠️ The box poppler reports is the FONT's box, not the glyph's ink: measured
 * on this repo's Inter, every string at 6pt comes back 7.26pt tall — "RETIRES",
 * "gjpqy" and "xxxxx" alike — which is (ascent + |descent|) = 1.21em. So a
 * `yMin` is NOT where the ink starts. The marker-label test below only ever
 * takes the DIFFERENCE of two such boxes, where the font's own padding cancels;
 * for the ink itself it rasterises (`inkAboveBaseline`).
 */
function wordBoxes(pdf: Buffer): Word[] {
  const dir = mkdtempSync(join(tmpdir(), "scenario-comparison-bbox-"));
  const file = join(dir, "sheet.pdf");
  try {
    writeFileSync(file, pdf);
    let xhtml: string;
    try {
      xhtml = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" });
    } catch (cause) {
      throw new Error(
        "this measurement needs `pdftotext` (poppler) on PATH — `brew install poppler`",
        { cause },
      );
    }
    const out: Word[] = [];
    let sheet = 0;
    for (const line of xhtml.split("\n")) {
      if (line.includes("<page ")) sheet += 1;
      const w = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">(.*)<\/word>/.exec(line);
      if (w) {
        out.push({
          text: w[5], sheet,
          xMin: Number(w[1]), yMin: Number(w[2]), xMax: Number(w[3]), yMax: Number(w[4]),
        });
      }
    }
    if (out.length === 0) throw new Error("pdftotext found no words in the rendered PDF");
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * How far a string's INK actually reaches above its baseline, at `size` in
 * Inter — measured, not estimated.
 *
 * `pdftotext -bbox` cannot answer this: the box poppler reports is the FONT's,
 * so at 6pt "RETIRES", "gjpqy" and "xxxxx" all come back 7.26pt tall
 * (ascent + |descent| = 1.21em). What the marker labels are budgeted against is
 * the ink — measured here by rasterising the string on its own page at 1200 DPI
 * and finding the first row that carries any. Note that the tallest ink in
 * "Retires 2050" is not a capital at all but the tittle on the "i", which is
 * why the cap-height figure this replaces came out low.
 */
const CAL_BASELINE = 200;
const CAL_LEFT = 40;
const RASTER_DPI = 1200;
/** Anything not paper-white counts: a clipped glyph loses its faintest,
 *  topmost antialiased row first, so a strict threshold would report the label
 *  as shorter than it prints. Measured on "Retires 2050": 4.58pt at this
 *  threshold, 4.52pt at the solid-ink 128 poppler's own text extraction uses. */
const INK = 250;
const PX = RASTER_DPI / 72;

async function inkAboveBaseline(label: string, size: number): Promise<number> {
  const pdf = await renderToBuffer(
    <Document>
      <Page size="LETTER" style={{ padding: 0 }}>
        <Svg width={612} height={300} viewBox="0 0 612 300">
          <SvgText
            x={CAL_LEFT}
            y={CAL_BASELINE}
            textAnchor="start"
            style={{ fontFamily: "Inter", fontSize: size, fill: "#000000" }}
          >
            {label}
          </SvgText>
        </Svg>
      </Page>
    </Document>,
  );

  const dir = mkdtempSync(join(tmpdir(), "scenario-comparison-ink-"));
  const file = join(dir, "cal.pdf");
  try {
    writeFileSync(file, pdf);
    // A crop keeps 1200 DPI affordable: 0.06pt per pixel over the 30pt band
    // above the baseline, and only the strip the label occupies.
    // Quantise the crop origin the way pdftoppm does, so the row index below
    // converts back to the same point the raster actually starts at.
    const cropTopPx = Math.round((CAL_BASELINE - 30) * PX);
    const top = cropTopPx / PX;
    let pgm: Buffer;
    try {
      pgm = execFileSync("pdftoppm", [
        "-gray", "-r", String(RASTER_DPI), "-f", "1", "-l", "1",
        "-x", String(Math.round((CAL_LEFT - 4) * PX)),
        "-y", String(cropTopPx),
        "-W", String(Math.round(300 * PX)),
        "-H", String(Math.round(31 * PX)),
        file,
      ], { maxBuffer: 256 * 1024 * 1024 });
    } catch (cause) {
      throw new Error(
        "this measurement needs `pdftoppm` (poppler) on PATH — `brew install poppler`",
        { cause },
      );
    }

    // PGM "P5\n<w> <h>\n<max>\n<bytes>", one byte per pixel.
    const header = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(pgm.subarray(0, 64).toString("latin1"));
    if (!header) throw new Error("pdftoppm did not return a PGM raster");
    const width = Number(header[1]);
    const start = header[0].length;
    for (let i = start; i < pgm.length; i += 1) {
      if (pgm[i] < INK) {
        const row = Math.floor((i - start) / width);
        return CAL_BASELINE - (top + row / PX);
      }
    }
    throw new Error(`no ink found for "${label}" — the calibration render is blank`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FRAME = {
  firmName: "Ethos Financial Group",
  clientName: "Alan & Teresa Whitfield",
  reportDate: "January 1, 2026",
  pageIndex: 3,
  totalPages: 8,
  accent: SECTION_ACCENTS.Comparison,
};

async function render(data: ScenarioComparisonPageData): Promise<Buffer> {
  return renderToBuffer(<Document>{ScenarioComparisonPagePdf({ data, ...FRAME })}</Document>);
}

// ── The fixture: a real view-model build, at the sizes the page must hold ───
// Adapted from render-smoke.test.tsx's bundle()/year() helpers, so the tax,
// retirement-row, change-line and net-to-heirs plumbing exercised here is the
// SAME code path the real report runs. Only the fields the page reads are
// populated; the rest is cast, because the page must not depend on shape it
// never touches.

const FIRST_YEAR = 2026;
const LAST_YEAR = 2075;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

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

/** Advisor-authored names, which the schema stores as unbounded `text`. These
 *  are the strings `describeChange` turns into change lines, and they are what
 *  the column cards and the bands' "What changed" lists print. */
const TARGET_NAMES: Record<string, string> = {
  "expense:e1": "Second home in Jackson Hole — property tax, insurance, utilities and the caretaker through 2049",
  "expense:e2": "Long-term care premium for Alan and Teresa, paid annually to age 85 with a 3% inflation rider",
  "income:i1": "Consulting retainer from the Ridgefield partnership, invoiced quarterly and ending at retirement",
  "account:a1": "Vanguard Total Stock Market Index Fund Admiral Shares — joint taxable, held at Schwab since 2011",
  "liability:l1": "Mortgage on the Jackson Hole property at 6.25% through 2049, with the escrow paid separately",
};

/** Five changes — one more than the band's four-line cap, so every band prints
 *  a "+1 more" tail and every card a "+3 more" tail.
 *
 *  Single-field EDITS, not removes: `describeChange` writes those as
 *  "<name> · <field>", which is the longest shape a change line takes and the
 *  one the caps actually have to hold. */
function changesFor(scenarioId: string) {
  return Object.keys(TARGET_NAMES).map((key, i) => {
    const [targetKind, targetId] = key.split(":");
    return {
      id: `${scenarioId}-c${i}`, scenarioId, opType: "edit", targetKind, targetId,
      payload: { annualAmount: { from: 40_000 + i * 1_000, to: 25_000 + i * 1_000 } },
      toggleGroupId: null, orderIndex: i,
    };
  });
}

function bundle(opts: {
  label: string;
  scenarioId: string | null;
  retirementAge: number;
  start: number;
  end: number;
  tax: number;
  successRate: number | null;
  maxSpend: number;
}) {
  const step = (opts.end - opts.start) / (YEARS.length - 1);
  return {
    scenarioLabel: opts.label,
    clientData: {
      client: {
        firstName: "Alan", lastName: "Whitfield", spouseName: "Teresa",
        dateOfBirth: "1988-04-01", retirementAge: opts.retirementAge,
      },
    },
    projection: { years: YEARS.map((y, i) => year(y, opts.start + step * i, opts.tax)) },
    monteCarlo: opts.successRate == null
      ? null
      : { summary: { successRate: opts.successRate, ending: { p20: opts.end / 4 } } },
    maxSpend: { realAnnualSpend: opts.maxSpend },
    scenarioChanges: opts.scenarioId
      ? {
          changes: changesFor(opts.scenarioId), toggleGroups: [],
          targetNames: TARGET_NAMES, baseLabel: "your current plan",
        }
      : undefined,
  } as never;
}

function ctx() {
  return {
    clientName: "Alan Whitfield", spouseName: "Teresa Whitfield",
    bundlesByRef: {
      base: bundle({ label: "Base Case", scenarioId: null, retirementAge: 62,
        start: 2_400_000, end: 4_800_000, tax: 40_000, successRate: 0.73, maxSpend: 92_000 }),
      // retirementAge 63 puts this column's marker on a DIFFERENT year from the
      // other three, which is what makes the chart stack two marker labels.
      "scenario:s1": bundle({ label: "Retire at 63 and downsize the Jackson Hole house", scenarioId: "s1",
        retirementAge: 63, start: 2_100_000, end: 4_200_000, tax: 20_000, successRate: 0.82, maxSpend: 214_000 }),
      // No Monte Carlo run: prints the footnote and a dash in two cells.
      "scenario:s2": bundle({ label: "Sell the condo and move the proceeds into bonds", scenarioId: "s2",
        retirementAge: 62, start: 2_600_000, end: 5_500_000, tax: 45_000, successRate: null, maxSpend: 150_000 }),
      "scenario:s3": bundle({ label: "Move to Texas and claim Social Security at 70", scenarioId: "s3",
        retirementAge: 62, start: 2_300_000, end: 4_100_000, tax: 42_000, successRate: 0.88, maxSpend: 175_000 }),
    },
  } as never;
}

/** Twelve sentences — four times the three-sentence budget three scenarios get,
 *  and twice the six a single scenario gets. */
const LONG_NARRATIVE = Array.from(
  { length: 12 },
  () => "Retiring a year earlier trades a slightly smaller ending balance for another year of the travel and the time with family you told us actually matters.",
).join(" ");

function buildData(scenarioIds: string[], over: Partial<typeof SCENARIO_COMPARISON_OPTIONS_DEFAULT> = {}) {
  return buildScenarioComparisonData(ctx(), {
    ...SCENARIO_COMPARISON_OPTIONS_DEFAULT,
    scenarioIds,
    ai: {
      ...SCENARIO_COMPARISON_OPTIONS_DEFAULT.ai,
      byScenario: Object.fromEntries(
        scenarioIds.map((id) => [id, { generatedText: LONG_NARRATIVE, generatedAt: null, sourceHash: null }]),
      ),
    },
    ...over,
  });
}

const MAXIMAL = buildData(["s1", "s2", "s3"]);
const TWO_SCENARIOS = buildData(["s1", "s2"]);
const ONE_SCENARIO = buildData(["s1"]);
const NO_SCENARIO = buildData([]);
const BANDS_OFF = buildData(["s1", "s2", "s3"], { showTradeoffBands: false });

describe("the fixture really is maximal", () => {
  it("fills every column, every cap and every optional block", () => {
    expect(MAXIMAL.columns).toHaveLength(MAX_COLUMNS);
    // Four change lines plus a tail on every band — the cap, not a short list.
    for (const band of MAXIMAL.bands) {
      expect(band.changeLines).toHaveLength(4);
      expect(band.moreChangeCount).toBeGreaterThan(0);
      expect(band.narrative.length).toBeGreaterThan(200);
    }
    // Two distinct retirement years, so the chart has two markers to stack.
    expect(new Set(MAXIMAL.chart?.markers.map((m) => m.atX))).toHaveLength(2);
    // A missing Monte Carlo run: the footnote prints and a cell shows a dash.
    expect(MAXIMAL.footnote).not.toBe("");
    expect(MAXIMAL.rows.find((r) => r.label === "Plan confidence")?.cells.map((c) => c.value))
      .toContain("—");
    // Max spend on, and the tax breakdown rows present.
    expect(MAXIMAL.rows.map((r) => r.label)).toContain("Max sustainable spending");
    expect(MAXIMAL.rows.filter((r) => r.indent).map((r) => r.label)).toEqual(["federal", "state"]);
    // Change lines long enough to wrap the 36%-wide left column of a band to
    // THREE lines. Change lines are capped at four ENTRIES, not at length, so a
    // fixture whose lines happen to fit in two would leave the band's own
    // `maxLines` cap doing nothing and the growth hazard untested (measured:
    // at 60-odd characters, deleting that cap changes nothing).
    expect(Math.min(...MAXIMAL.bands[0].changeLines.map((l) => l.length))).toBeGreaterThan(90);
  });
});

describe("sheet count", () => {
  /** Rendered sheets and the estimate the deck's Contents is numbered from —
   *  they have to be the same number or every later entry shifts. */
  async function sheetsAndEstimate(data: ScenarioComparisonPageData) {
    return { sheets: renderedPages(await render(data)), estimate: estimateScenarioComparisonPageCount(data) };
  }

  it("prints exactly two sheets with three scenarios and maximal content", async () => {
    expect(await sheetsAndEstimate(MAXIMAL)).toEqual({ sheets: 2, estimate: 2 });
  });

  it("prints exactly two sheets with two scenarios", async () => {
    expect(await sheetsAndEstimate(TWO_SCENARIOS)).toEqual({ sheets: 2, estimate: 2 });
  });

  it("prints exactly two sheets with one scenario", async () => {
    expect(await sheetsAndEstimate(ONE_SCENARIO)).toEqual({ sheets: 2, estimate: 2 });
  });

  it("prints one sheet with no scenario chosen", async () => {
    expect(NO_SCENARIO.isEmpty).toBe(true); // guard: this really is the empty path
    expect(await sheetsAndEstimate(NO_SCENARIO)).toEqual({ sheets: 1, estimate: 1 });
  });

  // Task 6's ruling: with the bands off there is nothing for sheet two to say,
  // so the composer omits it rather than print a section head over blank space.
  // The estimate has to move with the same predicate.
  it("prints one sheet when the tradeoff bands are off", async () => {
    expect(BANDS_OFF.isEmpty).toBe(false); // guard: scenarios ARE chosen
    expect(BANDS_OFF.bands).toEqual([]);   // guard: bands really are empty
    expect(await sheetsAndEstimate(BANDS_OFF)).toEqual({ sheets: 1, estimate: 1 });
  });
});

describe("column geometry", () => {
  /** Left edge of value column `i` on the paper: the frame's own padding plus
   *  the metric label column, then one value column per column to its left.
   *  Every number comes from the modules the page lays out with. */
  const columnLeft = (i: number) => PAGE_PAD_X + LABEL_COL_W + i * VALUE_COL_W;

  it("keeps every column value inside its 96pt cell", async () => {
    const words = (await wordBoxes(await render(MAXIMAL))).filter((w) => w.sheet === 1);

    const misplaced: string[] = [];
    let checked = 0;

    for (const row of MAXIMAL.rows) {
      // The row's own label anchors its band. Labels are left-aligned in the
      // metric column and vertically centred in the row; the value sits a few
      // points above that centre and its delta a few below, so a half-row
      // window either side of the label's centre takes the whole cell and
      // nothing from the rows above or below (the pitch is ~23pt).
      // The WHOLE label, not its first word: "Assets at retirement" and
      // "Assets end of life" share one, and matching on it alone reads the
      // wrong row's cells (measured — it printed the retirement row's figures
      // under the end-of-life row's expectations, and the mismatch is what
      // caught it).
      const tokens = row.label.split(" ");
      const label = words.find((w, i) =>
        w.xMin >= PAGE_PAD_X - 1
        && w.xMin < PAGE_PAD_X + LABEL_COL_W
        && tokens.every((t, k) => words[i + k]?.text === t
          && Math.abs(words[i + k].yMax - w.yMax) < 0.01),
      );
      expect(label, `no label word for row "${row.label}"`).toBeDefined();
      const centre = (label!.yMin + label!.yMax) / 2;

      const onRow = words.filter((w) => {
        const c = (w.yMin + w.yMax) / 2;
        return Math.abs(c - centre) <= 10 && w.xMin >= PAGE_PAD_X + LABEL_COL_W;
      });

      for (let i = 0; i < MAXIMAL.columns.length; i += 1) {
        const left = columnLeft(i);
        const right = left + VALUE_COL_W;
        // Sorted down-then-across: poppler's reading order interleaves the
        // two lines of a cell, and the value sits above its delta.
        const inCell = onRow
          .filter((w) => w.xMin >= left && w.xMin < right)
          .sort((a, b) => a.yMax - b.yMax || a.xMin - b.xMin);
        const printed = inCell.map((w) => w.text).join(" ");
        const cell = row.cells[i];
        const expected = [cell.value, cell.delta].filter(Boolean).join(" ");

        // Every glyph of this cell must be INSIDE the 96pt box, not merely
        // start in it — a value too wide for its column runs into the next.
        for (const w of inCell) {
          if (w.xMax > right) {
            misplaced.push(`"${w.text}" (${row.label}, col ${i}) ends at ${w.xMax.toFixed(1)}, past ${right}`);
          }
        }
        // …and it must be THIS cell's text, not the neighbour's.
        if (printed !== expected) {
          misplaced.push(`col ${i} of "${row.label}" printed "${printed}", expected "${expected}"`);
        }
        checked += 1;
      }
    }

    // Guard on the instrument: an empty sweep would pass silently.
    expect(checked).toBe(MAXIMAL.rows.length * MAX_COLUMNS);
    expect(misplaced).toEqual([]);
  });
});

describe("the strings the spec binds", () => {
  it("prints both eyebrows and sheet two's title", async () => {
    const words = await wordBoxes(await render(MAXIMAL));
    const textOf = (sheet: number) =>
      words.filter((w) => w.sheet === sheet).map((w) => w.text).join(" ");

    expect(textOf(1)).toContain("SCENARIO COMPARISON");
    expect(textOf(1)).not.toContain("TRADEOFFS");
    expect(textOf(2)).toContain("SCENARIO COMPARISON — TRADEOFFS");
    expect(textOf(2)).toContain("What each scenario trades");
  });
});

describe("retirement marker labels", () => {
  /**
   * Task 5 raised `chart-spec.ts`'s `margin.top` from 8 to 16 because
   * `markerLabelLayout` gets `floor(top / MARKER_LABEL_ROW_H)` rows: at 8 that
   * is ONE row, so two nearby retirement years were forced onto the same
   * baseline and printed through each other — the defect `chart-geom.ts`
   * records as having shipped in a client deck. The second row's baseline sits
   * `MARKER_LABEL_ROW_H` above the first, and its caps have to clear the top of
   * the canvas, because an `Svg` child past the viewport is simply not drawn.
   *
   * The clearance that arithmetic leaves is thin, and Task 5 computed it from
   * an ESTIMATED 0.727em cap height. Both terms are measured here instead: the
   * row gap from the rendered sheet, the ink height from a raster of the label
   * itself. Measured, 16 was 0.02pt SHORT — hence the 17 this now holds.
   */
  it("draws both rows, one row apart, with their caps on the canvas", async () => {
    const spec = MAXIMAL.chart!;
    expect(spec.markers).toHaveLength(2); // guard: there really are two to stack

    const words = (await wordBoxes(await render(MAXIMAL))).filter((w) => w.sheet === 1);

    /** The label's own box top. poppler reports the FONT box rather than the
     *  ink, but every marker label is the same font at the same size, so the
     *  difference between two of them is exactly the difference between their
     *  baselines. */
    const boxTopOf = (label: string) => {
      const [head, tail] = label.split(" ");
      const found = words.find((w) => w.text === head && words.some(
        (other) => other.text === tail
          && Math.abs(other.yMax - w.yMax) < 0.01
          && other.xMin > w.xMin,
      ));
      expect(found, `marker label "${label}" is not in the rendered sheet`).toBeDefined();
      return found!.yMin;
    };

    const tops = spec.markers.map((m) => boxTopOf(m.label));
    const rowGap = Math.abs(tops[0] - tops[1]);
    expect(rowGap, "the two labels are not one row apart — they share a baseline")
      .toBeCloseTo(MARKER_LABEL_ROW_H, 2);

    // How far the label's ink reaches above its baseline — the worst of the
    // two, since either one can be the row that got stacked.
    const capHeight = Math.max(
      ...(await Promise.all(spec.markers.map((m) => inkAboveBaseline(m.label, 6)))),
    );

    // …and `chart-geom.ts` owns that figure for everything that budgets against
    // it. Re-measuring it here is what keeps the owned number from going stale:
    // the 0.727em cap-height estimate it replaced sat in exactly this slot and
    // let a clipped label pass. The tolerance is the raster's own resolution,
    // 1/PX of a point.
    expect(capHeight / 6).toBeCloseTo(MARKER_LABEL_INK_EM, 3);

    // The upper row's baseline sits `MARKER_LABEL_BASE_Y + rowGap` above the
    // plot, and the plot starts `margin.top` below the canvas top.
    const clearance = spec.margin.top + MARKER_LABEL_BASE_Y - rowGap - capHeight;
    expect(
      clearance,
      `the upper marker label's ink hangs ${(-clearance).toFixed(3)}pt off the top of the ` +
      `canvas (measured ${capHeight.toFixed(3)}pt above the baseline at 6pt) — raise chart-spec.ts's ` +
      `margin.top to at least ${(rowGap - MARKER_LABEL_BASE_Y + capHeight).toFixed(3)}`,
    ).toBeGreaterThanOrEqual(0);
  });
});
