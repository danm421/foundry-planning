// Does the KPI strip's text stay inside its cards?
//
// Nothing else in this suite can answer that. `render-smoke` asserts
// `byteLength > 1000`; tsc and eslint see JSX. The five-card strip shipped with
// "$170K/yr → $175K/yr" printing over its own card border and into the
// neighbour, past 2722 green tests, and the only instrument that saw it was a
// human looking at a rendered page.
//
// So: render the real page component from a fixture, and measure the actual
// glyph boxes with `pdftotext -bbox`. The card boxes come from ./kpi-geom,
// which is also what `page-pdf.tsx` lays out with — a guard that hand-builds
// its own spec measures a page the product never prints.
//
// Needs poppler on PATH (`brew install poppler`), same as
// `plan-story-render.test.tsx`. It says so rather than skipping: a measurement
// that quietly opts out is worse than one that is absent, because the suite
// goes on reporting green.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { wordBoxes, BBOX_EPS as EPS, type Word } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { RetirementComparisonPagePdf } from "./page-pdf";
import { kpiCardBoxes } from "./kpi-geom";
import type {
  KpiCard,
  RetirementComparisonPageData,
} from "@/lib/presentations/pages/retirement-comparison/types";

/**
 * The strip's vertical band, found from the render's own structure rather than
 * from a remembered y.
 *
 * The card labels and the deltas each put a word at EVERY card's content-left,
 * so a text line carrying words at four or more distinct card-lefts is a strip
 * row and nothing else on the page is. (The base→scenario value line does not
 * qualify — a two-line label pushes those cards' values down, so the values do
 * not share one line. Bounding by the label row and the delta row spans them.)
 */
function stripBand(words: Word[], lefts: number[]): { top: number; bottom: number } {
  const lines = new Map<string, Word[]>();
  for (const w of words) {
    const key = w.yMin.toFixed(1);
    lines.set(key, [...(lines.get(key) ?? []), w]);
  }
  const rows: Word[][] = [];
  for (const line of lines.values()) {
    const hit = new Set<number>();
    for (const w of line) {
      const i = lefts.findIndex((l) => Math.abs(w.xMin - l) <= EPS);
      if (i >= 0) hit.add(i);
    }
    if (hit.size >= 4) rows.push(line);
  }
  // Two rows exactly: the labels' first line, and the deltas. If this ever
  // finds none, the band would be empty and every assertion below would pass
  // vacuously — so it is an error, not a skip.
  expect(rows.length, "no KPI rows found — the strip's structure changed and this guard is measuring nothing").toBeGreaterThanOrEqual(2);
  return {
    top: Math.min(...rows.flat().map((w) => w.yMin)),
    bottom: Math.max(...rows.flat().map((w) => w.yMax)),
  };
}

/** The widest realistic strip: five cards, and the rate-valued pair that
 *  overflowed on the live Sheskier deck. */
const KPIS: KpiCard[] = [
  { label: "Retirement age", base: "65", scenario: "60", delta: "−5 yrs", direction: 1, show: true },
  { label: "Plan confidence", base: "100%", scenario: "83%", delta: "−17 pts", direction: -1, show: true },
  { label: "Legacy to heirs", base: "$20.2M", scenario: "$12.3M", delta: "−$7.9M", direction: 0, show: true },
  { label: "Max sustainable spend", base: "$170K/yr", scenario: "$175K/yr", delta: "+$5K/yr", direction: 1, show: true },
  { label: "Downside ending balance", base: "$13.4M", scenario: "$1.9M", delta: "−$11.5M", direction: -1, show: true },
];

const EMPTY_BUCKETS = { cash: 0, taxable: 0, preTax: 0, roth: 0, hsa: 0 };

function fixture(kpis: KpiCard[]): RetirementComparisonPageData {
  return {
    title: "Retirement Comparison",
    subtitle: "Base Case vs. New Plan",
    isEmpty: false,
    verdict: { headline: "83% chance your plan fully funds your life (was 100%)." },
    kpis,
    overlay: Array.from({ length: 45 }, (_, i) => ({
      year: 2026 + i,
      floor: 1_000_000 * 1.04 ** i,
      scenarioAhead: 0,
      baseAhead: 0,
    })),
    atRetirement: { baseYear: 2042, scenarioYear: 2037, base: EMPTY_BUCKETS, scenario: EMPTY_BUCKETS },
    atEndOfLife: { baseYear: 2070, scenarioYear: 2070, base: EMPTY_BUCKETS, scenario: EMPTY_BUCKETS },
    maxSpend: { show: false, baseToday: 0, scenarioToday: 0, series: [] },
    confidence: { show: false, points: [] },
    showPortfolioMatrix: false,
    showAiSummary: false,
    aiMarkdown: "",
  };
}

async function stripWords(kpis: KpiCard[]) {
  ensureFontsRegistered();
  const pdf = await renderToBuffer(
    <Document>
      {RetirementComparisonPagePdf({
        data: fixture(kpis),
        firmName: "Ethos Financial Group",
        clientName: "Cooper Sample",
        reportDate: "June 10, 2026",
        pageIndex: 1,
        totalPages: 2,
        accent: SECTION_ACCENTS.Comparison,
      })}
    </Document>,
  );
  const boxes = kpiCardBoxes(kpis.length);
  const words = wordBoxes(pdf, 1);
  const band = stripBand(words, boxes.map((b) => b.left));
  const inBand = words.filter((w) => w.yMin >= band.top - EPS && w.yMax <= band.bottom + EPS);
  // Each word belongs to the rightmost card it starts at or after.
  const owned = inBand.map((w) => {
    let card = -1;
    boxes.forEach((b, i) => { if (w.xMin >= b.left - EPS) card = i; });
    return { ...w, card };
  });
  return { boxes, owned };
}

describe("Retirement Comparison KPI strip geometry", () => {
  it("keeps every value inside its own card at five cards", async () => {
    const { boxes, owned } = await stripWords(KPIS);

    // The instrument has to be shown to be looking at something. Without this
    // an empty band would report a clean strip.
    expect(owned.length).toBeGreaterThanOrEqual(20);
    for (let i = 0; i < boxes.length; i++) {
      expect(owned.filter((w) => w.card === i).length, `card ${i} has no measured text`).toBeGreaterThan(0);
    }

    const overflow = owned
      .filter((w) => w.card >= 0 && w.xMax > boxes[w.card].right + EPS)
      .map((w) => `"${w.text}" in card ${w.card} runs to ${w.xMax.toFixed(1)}pt, past its content box at ${boxes[w.card].right.toFixed(1)}pt`);
    expect(overflow).toEqual([]);
  }, 30_000);

  it("keeps every value inside its own card at four cards", async () => {
    // A card self-hides when its figure is unavailable, which widens the rest —
    // the four-card strip is a different layout, not a safer one.
    const { boxes, owned } = await stripWords(KPIS.slice(1));
    expect(owned.length).toBeGreaterThanOrEqual(16);
    const overflow = owned
      .filter((w) => w.card >= 0 && w.xMax > boxes[w.card].right + EPS)
      .map((w) => `"${w.text}" in card ${w.card} runs to ${w.xMax.toFixed(1)}pt, past ${boxes[w.card].right.toFixed(1)}pt`);
    expect(overflow).toEqual([]);
  }, 30_000);
});
