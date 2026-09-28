// Does the Tax Summary still hold one sheet with the bracket chart on it?
//
// The deck plans its page numbers from `estimateTaxSummaryPageCount`, which
// says 1, so a layout that breaks onto a second sheet throws the numbering off;
// one that runs into the footer band prints over the disclaimer. Neither shows
// up in tsc, eslint or the view-model tests, so this renders the real page from
// a 60-year plan with the longest takeaways the narrator writes, and reads the
// glyph boxes back out of the PDF.
//
// Needs poppler on PATH (`brew install poppler`), via `pdf-bbox`.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear, ClientData } from "@/engine/types";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { wordBoxes, renderedPages, BBOX_EPS as EPS } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { assertGutterHolds, labelBox, renderChartWords } from "@/components/presentations/shared/test-utils/axis-geometry";
import { makeTaxResult } from "@/lib/presentations/shared/__tests__/tax-fixtures";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { buildTaxSummaryData } from "@/lib/presentations/pages/tax-summary/view-model";
import { buildTaxNarrative } from "@/lib/presentations/pages/tax-summary/narrative";
import { TAX_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/tax-summary/options-schema";
import type { TaxSummaryPageData } from "@/lib/presentations/pages/tax-summary/view-model";
import { TaxSummaryPagePdf } from "../page-pdf";
import { CashflowChartPdf } from "../../cash-flow/chart-pdf";

ensureFontsRegistered();

const FRAME = {
  firmName: "Foundry Wealth",
  clientName: "Alan & Teresa",
  reportDate: "August 12, 2026",
  pageIndex: 1,
  totalPages: 1,
  accent: DEFAULT_ACCENT,
};

/** Landscape LETTER is 612pt tall; `PageFrame` reserves the bottom 72pt for the
 *  footer band, and a word whose foot is below this line prints over it. */
const CONTENT_BOTTOM = 612 - 72;

/** 2026's joint ladder. Indexed each year so the floors climb like the engine's. */
const LADDER = [
  { from: 0, to: 24_800, rate: 0.1 },
  { from: 24_800, to: 100_800, rate: 0.12 },
  { from: 100_800, to: 211_400, rate: 0.22 },
  { from: 211_400, to: 403_550, rate: 0.24 },
  { from: 403_550, to: 512_450, rate: 0.32 },
  { from: 512_450, to: 768_700, rate: 0.35 },
  { from: 768_700, to: null, rate: 0.37 },
];

/** A 60-year plan starting in 2030 — so both charts label 2030. The early
 *  years sit in the 35% tier, which puts every floor under the axis ceiling:
 *  the most legend rows current law can produce. */
function plan(): ProjectionYear[] {
  return Array.from({ length: 60 }, (_, i) => {
    const f = 1.025 ** i;
    const tiers = LADDER.map((t) => ({ from: t.from * f, to: t.to == null ? null : t.to * f, rate: t.rate }));
    const base = (i < 15 ? 600_000 : 150_000) * f;
    const filled = tiers.find((t) => base >= t.from && (t.to == null || base < t.to))!;
    const conversion = i < 6 ? 60_000 : 0;
    return {
      year: 2030 + i,
      ages: { client: 60 + i, spouse: null },
      accountLedgers: { ira: { endingValue: 900_000 }, roth: { endingValue: 300_000 } },
      portfolioAssets: { cash: {}, taxable: {}, retirement: { ira: 900_000, roth: 300_000 } },
      rothConversions: conversion ? [{ id: "c1", name: "Fill", gross: conversion, taxable: conversion }] : [],
      taxResult: makeTaxResult({
        flow: {
          incomeTaxBase: base, totalFederalTax: 150_000 * f, capitalGainsTax: 4_000,
          stateTax: 30_000 * f, fica: 9_000, totalTax: 189_000 * f,
        },
        diag: { marginalFederalRate: filled.rate, marginalBracketTier: filled, incomeBracketsForFiling: tiers },
      }),
    } as unknown as ProjectionYear;
  });
}

function sheetData(taxEngineMode: "bracket" | "flat"): TaxSummaryPageData {
  const clientData = {
    client: { dateOfBirth: "1970-01-01", retirementAge: 65 },
    accounts: [
      { id: "ira", category: "retirement", subType: "traditional_ira" },
      { id: "roth", category: "retirement", subType: "roth_ira" },
    ],
    planSettings: { taxEngineMode },
  } as unknown as ClientData;
  const ctx = { years: plan(), clientData, scenarioLabel: "Proposed — Retire at 63" } as unknown as BuildDataContext;
  const data = buildTaxSummaryData(ctx, TAX_SUMMARY_OPTIONS_DEFAULT);
  // The narrator's four longest lines, with the widest figures it prints.
  const narrative = buildTaxNarrative({
    lifetimeTotal: 12_345_678, effectiveRate: 0.284, bracketMode: true,
    yearsBelowLow: 27, yearsAboveHigh: 33, lowThreshold: 0.22, highThreshold: 0.24,
    rothConversionTotal: 1_250_000, rothConversionYears: 12, rothFirstYear: 2030, rothLastYear: 2041,
    irmaaYears: 18, irmaaTotal: 96_000, largestGain: { year: 2044, gain: 2_400_000, tax: 480_000 },
  });
  expect(narrative).toHaveLength(4);
  return { ...data, narrative };
}

const render = (data: TaxSummaryPageData) =>
  renderToBuffer(<Document>{TaxSummaryPagePdf({ data, ...FRAME })}</Document>);

/** The words the frame itself prints in the footer band, learned once from an
 *  empty sheet so they are subtracted by identity, not by height — a height
 *  rule would ignore exactly the words this guard exists to find. */
let frameWords: Promise<Set<string>> | null = null;
function footerWords(): Promise<Set<string>> {
  frameWords ??= render({ ...sheetData("bracket"), isEmpty: true }).then(
    (pdf) =>
      new Set(
        wordBoxes(pdf)
          .filter((w) => w.yMin > CONTENT_BOTTOM)
          .map((w) => `${w.text}|${w.xMin}|${w.yMin}`),
      ),
  );
  return frameWords;
}

describe("Tax Summary sheet — really rendered", () => {
  it.each(["bracket", "flat"] as const)(
    "holds a 60-year plan and the longest takeaways on one sheet, clear of the footer (%s mode)",
    async (mode) => {
      const data = sheetData(mode);
      expect(data.bracketChart == null).toBe(mode === "flat");

      const pdf = await render(data);
      expect(renderedPages(pdf)).toBe(1);

      const frame = await footerWords();
      const body = wordBoxes(pdf, 1).filter((w) => !frame.has(`${w.text}|${w.xMin}|${w.yMin}`));
      expect(body.length, "no page content found — the guard is measuring nothing").toBeGreaterThan(0);
      const low = body.filter((w) => w.yMax > CONTENT_BOTTOM + EPS).map((w) => `"${w.text}" foot at ${w.yMax.toFixed(1)}pt`);
      expect(low).toEqual([]);
    },
    60_000,
  );

  // Stacked charts on one time axis are read top to bottom — "that tall tax
  // year is which bracket?" — so a year has to stand in one column on both.
  it("stands each year's taxes bar over the same year in the bracket chart", async () => {
    const words = wordBoxes(await render(sheetData("bracket")), 1);
    const centre = (label: string) => {
      const b = labelBox(words, label);
      return (b.xMin + b.xMax) / 2;
    };
    expect(Math.abs(centre("'30") - centre("2030"))).toBeLessThan(EPS);
  }, 60_000);

  it("keeps the bracket chart's dollar labels in its narrower gutter", async () => {
    const spec = sheetData("bracket").bracketChart!;
    const words = await renderChartWords(spec, <CashflowChartPdf spec={spec} />);
    assertGutterHolds(spec, words, spec.yAxis.ticks.map(spec.yAxis.labelFormat));
  }, 60_000);
});
