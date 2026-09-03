// Do the Retirement Comparison sheets name the REAL plans, and does every name
// stay inside the box it was laid out in?
//
// These sheets printed the literal words "Current" and "Proposed" on seven
// surfaces. That is a lie the moment the advisor picks a scenario as the
// baseline: the subtitle beside them reads "Maximum Spend vs. Proposed Plan"
// and every KPI names the real plans, so the sheet contradicted itself. Nothing
// in the suite could see it — the browser pass over these very pages was 11/11
// green while the words were still hard-coded.
//
// Naming the real plans then creates the opposite failure: a name is
// advisor-typed and arbitrarily long, and each of the five surfaces has its own
// width. Two failure modes, and they need different instruments:
//   - a name WITH a space wraps and pushes the whole page down;
//   - a name with NO space cannot wrap, so it overruns and OVERPRINTS its
//     neighbour. On the SVG axis labels that is silent — SVG text neither wraps
//     nor clips.
// So this guard renders the real component and measures the glyph boxes.
//
// Needs poppler on PATH (`brew install poppler`), same as the sibling
// `kpi-strip-geometry` guard. It says so rather than skipping.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { wordBoxes, type Word } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { RetirementComparisonPagePdf } from "./page-pdf";
import type { RetirementComparisonPageData } from "@/lib/presentations/pages/retirement-comparison/types";

const BUCKETS_A = { cash: 412_000, taxable: 1_900_000, preTax: 1_400_000, roth: 300_000, hsa: 40_000 };
const BUCKETS_B = { cash: 683_000, taxable: 3_500_000, preTax: 1_600_000, roth: 600_000, hsa: 80_000 };

/**
 * A sheet with every label-bearing block switched on.
 *
 * The two horizons deliberately fall in DIFFERENT years on both pages: that is
 * the only path on which `horizonYearsLabel` prints the plan names at all, so a
 * fixture with matching years would measure a heading the guard cares about
 * while the names it is guarding are absent from it.
 */
function fixture(baselineLabel: string, scenarioLabel: string): RetirementComparisonPageData {
  return {
    title: "Retirement Comparison",
    subtitle: `${baselineLabel} vs. ${scenarioLabel}`,
    baselineLabel,
    scenarioLabel,
    isEmpty: false,
    verdict: { headline: "99% chance your plan fully funds your life — up from 83%." },
    kpis: [
      { label: "Plan confidence", base: "83%", scenario: "99%", delta: "+16 pts", direction: 1, show: true },
      { label: "Legacy to heirs", base: "$10.8M", scenario: "$34.4M", delta: "+$23.6M", direction: 0, show: true },
    ],
    overlay: Array.from({ length: 45 }, (_, i) => ({
      year: 2026 + i,
      floor: 1_000_000 * Math.pow(1.04, i),
      scenarioAhead: 0,
      baseAhead: 0,
    })),
    atRetirement: { baseYear: 2042, scenarioYear: 2037, base: BUCKETS_A, scenario: BUCKETS_B },
    atEndOfLife: { baseYear: 2068, scenarioYear: 2070, base: BUCKETS_A, scenario: BUCKETS_B },
    maxSpend: {
      show: true,
      baseToday: 92_000,
      scenarioToday: 214_000,
      series: Array.from({ length: 34 }, (_, i) => ({ year: 2037 + i, base: 92_000, scenario: 214_000 })),
    },
    confidence: {
      show: true,
      points: Array.from({ length: 34 }, (_, i) => ({
        year: 2037 + i,
        baseP20: 1e6, baseP50: 2e6, baseP80: 3e6,
        scnP20: 2e6, scnP50: 4e6, scnP80: 6e6,
      })),
    },
    showPortfolioMatrix: true,
    showAiSummary: false,
    aiMarkdown: "",
  };
}

async function render(baselineLabel: string, scenarioLabel: string): Promise<Buffer> {
  ensureFontsRegistered();
  return renderToBuffer(
    <Document>
      {RetirementComparisonPagePdf({
        data: fixture(baselineLabel, scenarioLabel),
        firmName: "Ethos Financial Group",
        clientName: "Cooper Sample",
        reportDate: "June 10, 2026",
        pageIndex: 1,
        totalPages: 2,
        accent: SECTION_ACCENTS.Comparison,
      })}
    </Document>,
  );
}

/**
 * Words grouped into the text baselines they sit on, each row ordered left to
 * right. Rows must be x-sorted AFTER grouping: words that share a visual line
 * differ slightly in yMin, so a global sort by (yMin, xMin) interleaves them
 * and every adjacent pair then looks like an overprint.
 */
function rowsOf(words: Word[]): Word[][] {
  const rows = new Map<number, Word[]>();
  for (const w of words) {
    const key = [...rows.keys()].find((k) => Math.abs(k - w.yMin) < 1.5) ?? w.yMin;
    const row = rows.get(key);
    if (row) row.push(w);
    else rows.set(key, [w]);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => [...r].sort((a, b) => a.xMin - b.xMin));
}

/** One string per text baseline, uppercased — the sheet uppercases its headings
 *  in CSS, so the glyphs come back uppercase whatever was passed in. */
function linesOf(words: Word[]): string[] {
  return rowsOf(words).map((r) => r.map((w) => w.text).join(" ").toUpperCase());
}

/**
 * The text baselines carrying an overprint — adjacent words whose glyph boxes
 * intersect — as "p<page> y=<baseline>".
 *
 * Reported per ROW rather than per word pair so the result can be compared
 * across two renders whose words differ. The max-spend chart's own axis caption
 * already overlaps a value label on page 2; that is pre-existing and not what
 * this guard is about, so the assertion compares a long-name render against a
 * short-name one instead of demanding an empty set.
 */
function overprintRows(pdf: Buffer): string[] {
  const out: string[] = [];
  for (const page of [1, 2] as const) {
    for (const row of rowsOf(wordBoxes(pdf, page))) {
      for (let i = 0; i + 1 < row.length; i++) {
        if (row[i + 1].xMin < row[i].xMax) {
          out.push(`p${page} y=${row[i].yMin.toFixed(1)}`);
          break;
        }
      }
    }
  }
  return [...new Set(out)].sort();
}

describe("Retirement Comparison plan labels", () => {
  it("names the two real plans on both sheets and never the word 'Current'", async () => {
    const pdf = await render("Maximum Spend", "Proposed Plan");
    const p1 = linesOf(wordBoxes(pdf, 1));
    const p2 = linesOf(wordBoxes(pdf, 2));

    // The instrument has to be shown to be looking at something: an empty read
    // would satisfy every "does not contain" assertion below.
    expect(p1.length).toBeGreaterThan(10);
    expect(p2.length).toBeGreaterThan(10);

    // Page 1 — the chart heading, the at-retirement horizon, and the table
    // header. (The SVG axis labels are capped tighter and checked separately.)
    expect(p1.some((l) => l.includes("PORTFOLIO ASSETS OVER TIME — PROPOSED PLAN VS. MAXIMUM SPEND"))).toBe(true);
    expect(p1.some((l) => l.includes("AT RETIREMENT (MAXIMUM SPEND 2042 · PROPOSED PLAN 2037)"))).toBe(true);
    expect(p1.some((l) => l.includes("MAXIMUM SPEND PROPOSED PLAN CHANGE"))).toBe(true);

    // Page 2 — both chart legends and the end-of-life horizon and table header.
    expect(p2.filter((l) => l.includes("MAXIMUM SPEND")).length).toBeGreaterThanOrEqual(3);
    expect(p2.some((l) => l.includes("AT END OF LIFE (MAXIMUM SPEND 2068 · PROPOSED PLAN 2070)"))).toBe(true);
    expect(p2.some((l) => l.includes("MAXIMUM SPEND PROPOSED PLAN CHANGE"))).toBe(true);

    // The defect itself: neither sheet may call a plan "Current".
    expect([...p1, ...p2].filter((l) => l.includes("CURRENT"))).toEqual([]);
  }, 30_000);

  it("keeps every plan name inside its box, even an unbroken 40-character name", async () => {
    // No spaces, so nothing can wrap: whatever does not fit OVERPRINTS. That is
    // the case the SVG axis labels fail silently on — they neither wrap nor
    // clip, they print over their neighbour.
    const short = await render("Base Case", "Proposed Plan");
    const long = await render("M".repeat(40), "M".repeat(40));

    // The instrument has to be shown to be able to fail: a 40-M name at the
    // caps these sheets shipped before this guard DID overprint, so an empty
    // baseline set would mean the reader, not the page, is clean.
    expect(rowsOf(wordBoxes(long, 1)).length).toBeGreaterThan(10);
    expect(overprintRows(long)).toEqual(overprintRows(short));

    // The page-1 chart heading fails the OTHER way — it wraps rather than
    // overprints — and an unbreakable name always breaks it right after
    // "vs.", so the heading must not be the last thing on its line. Without
    // this, HEAD_CAP could be loosened and nothing above would notice.
    const heading = linesOf(wordBoxes(long, 1)).find((l) => l.startsWith("PORTFOLIO ASSETS OVER TIME"));
    expect(heading, "page-1 chart heading not found").toBeDefined();
    expect(heading!.endsWith("VS."), `heading wrapped: "${heading}"`).toBe(false);
  }, 60_000);

  it("does not reflow either sheet for an ordinary long plan name", async () => {
    // Every text baseline of a long-but-realistic pair must match a short pair's,
    // i.e. nothing wrapped and pushed the page down.
    const short = await render("Base Case", "Proposed Plan");
    const long = await render("Aggressive Roth Conversion Ladder Plan", "Delayed Retirement Plus Roth Ladder");
    for (const page of [1, 2] as const) {
      const ys = (pdf: Buffer) => [...new Set(wordBoxes(pdf, page).map((w) => Math.round(w.yMin * 10) / 10))].sort((a, b) => a - b);
      expect(ys(long), `page ${page} reflowed`).toEqual(ys(short));
    }
  }, 60_000);
});
