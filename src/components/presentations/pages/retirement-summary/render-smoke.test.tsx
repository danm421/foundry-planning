// src/components/presentations/pages/retirement-summary/render-smoke.test.tsx
//
// The Retirement Summary claims two sheets (estimateRetirementSummaryPageCount)
// and the table of contents numbers every later page from that claim. A sheet
// that overflows by even a point makes react-pdf emit a THIRD page carrying
// nothing but the fixed footer — a blank sheet in a client deck, and every
// following ToC entry off by one. Only a real render can see it: the page
// components type-check and the view-model tests pass either way.
//
// Two invariants, because they are not the same promise:
//   • a representative client lays out on exactly the two sheets the estimate
//     promises (this is the blank-page-8 regression);
//   • whatever the content, no sheet may carry ONLY the fixed footer. A long
//     client legitimately paginates to three; it may never paginate to a
//     blank.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { RetirementSummaryPagePdf } from "./page-pdf";
import type { ChartSpec } from "@/lib/presentations/charts/types";
import { FUNDING_CHART_BOX } from "@/lib/presentations/pages/retirement-summary/view-model";
import type { RetirementSummaryPageData } from "@/lib/presentations/pages/retirement-summary/view-model";
import type { SsClient } from "@/lib/presentations/pages/retirement-summary/social-security";

/** The PDF's page-tree node — `<< /Type /Pages /Count n /Kids […] >>`, written
 *  uncompressed by pdfkit. The count react-pdf actually laid out, not the one
 *  the estimator promised. */
function renderedPages(pdf: Buffer): number {
  const match = /\/Type \/Pages\s*\/Count (\d+)/.exec(pdf.toString("latin1"));
  if (!match) throw new Error("no page-tree node in the rendered PDF");
  return Number(match[1]);
}

/** Everything each sheet prints ABOVE the fixed footer. `pdftotext` emits a
 *  form feed per page; the footer is the disclaimer plus the two rails, and a
 *  sheet with nothing else on it is the blank page this file exists to catch. */
function bodyTextPerSheet(pdf: Buffer): string[] {
  const dir = mkdtempSync(join(tmpdir(), "rs-render-"));
  const file = join(dir, "p.pdf");
  writeFileSync(file, pdf);
  let text: string;
  try {
    text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
  } catch {
    throw new Error("this measurement needs `pdftotext` (poppler) on PATH — `brew install poppler`");
  }
  return text.split("\f").filter((_, i, a) => i < a.length - 1 || a[i].trim() !== "").map((sheet) =>
    sheet
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return (
          t !== "" &&
          !t.startsWith("For illustrative and discussion purposes only") &&
          t !== "Confidential · Personal" &&
          !/^Page \d+ of \d+$/.test(t)
        );
      })
      .join("\n")
      .trim(),
  );
}

const YEARS = Array.from({ length: 31 }, (_, i) => 2054 + i);

const chartSpec: ChartSpec = {
  kind: "stackedBarWithLine",
  // The box the deck actually prints, not a look-alike — a guard measuring a
  // panel 16pt taller than the shipped one cannot see the sheet it overflows.
  width: FUNDING_CHART_BOX.width,
  height: FUNDING_CHART_BOX.height,
  margin: { top: FUNDING_CHART_BOX.marginTop, right: 16, bottom: 56, left: 64 },
  xAxis: {
    domain: YEARS,
    ticks: YEARS.filter((y) => y % 5 === 0),
    labelFormat: (v) => String(v),
  },
  yAxis: {
    domain: [0, 2_000_000],
    ticks: [0, 500_000, 1_000_000, 1_500_000, 2_000_000],
    labelFormat: (v) => `$${Math.round(v / 1000)}k`,
    gridlineColor: "#e6e2d8",
  },
  stacks: [
    { seriesId: "ss", label: "Social Security", color: "#2f5597", values: YEARS.map(() => 60_000) },
    { seriesId: "sal", label: "Salaries", color: "#1f7a5a", values: YEARS.map(() => 0) },
    { seriesId: "other", label: "Other Inflows", color: "#127a72", values: YEARS.map(() => 12_000) },
    { seriesId: "rmd", label: "RMDs", color: "#d1701a", values: YEARS.map((_, i) => 200_000 + i * 20_000) },
    { seriesId: "wd", label: "Withdrawals", color: "#b03030", values: YEARS.map(() => 30_000) },
  ],
  lines: [
    {
      seriesId: "exp",
      label: "Total Expenses",
      color: "#1a1a1a",
      strokeWidth: 1.25,
      values: YEARS.map((_, i) => 300_000 + i * 15_000),
    },
  ],
  markers: [],
  legend: {
    position: "bottom",
    items: [
      { label: "Social Security", color: "#2f5597", kind: "swatch" },
      { label: "Salaries", color: "#1f7a5a", kind: "swatch" },
      { label: "Other Inflows", color: "#127a72", kind: "swatch" },
      { label: "RMDs", color: "#d1701a", kind: "swatch" },
      { label: "Withdrawals", color: "#b03030", kind: "swatch" },
      { label: "Total Expenses", color: "#1a1a1a", kind: "line" },
    ],
  },
};

function ssClient(name: string): SsClient {
  return {
    name,
    piaMonthly: 4274,
    claimAge: 67,
    colaPct: 0.02,
    alreadyClaiming: false,
    receivedMonthly: null,
    // 62–70, the widest ladder the page ever prints.
    ladder: Array.from({ length: 9 }, (_, i) => ({
      age: 62 + i,
      monthly: 2992 + i * 290,
      selected: 62 + i === 67,
    })),
  };
}

/** Everything page 2 can be asked to print at once: two Social Security
 *  ladders, every optional expense row, income rows, asset transactions, a
 *  shortfall (which adds its own funding segment and narrative line) and the
 *  four-line takeaway list. If this fits on two sheets, a real client does. */
const FULL: RetirementSummaryPageData = {
  title: "Retirement Summary",
  subtitle: "Base Case · Retire age 65 in 2054 · through 2084",
  isEmpty: false,
  isMarried: true,
  kpis: {
    monteCarlo: "82%",
    liquidNow: 165_442,
    liquidRetirement: 8_526_000,
    liquidEndOfLife: 20_180_000,
    retirementAge: 65,
    retirementYear: 2054,
    totalSpend: 13_500_000,
  },
  liquid: { now: 165_442, retirement: 8_526_000, endOfLife: 20_180_000 },
  bars: YEARS.map((year, i) => ({
    year,
    cash: 3_600_000 + i * 10_000,
    taxable: 250_000,
    retirement: 4_900_000 + i * 40_000,
    total: 8_750_000 + i * 50_000,
  })),
  byType: { cash: 3_600_000, taxable: 0, retirement: 4_926_000, total: 8_526_000 },
  byTaxType: { roth: 426_000, preTax: 4_500_000, taxable: 3_600_000, total: 8_526_000 },
  funding: {
    socialSecurity: 1_700_000,
    otherIncome: 240_000,
    rmds: 10_300_000,
    withdrawalsCash: 1_000_000,
    withdrawalsTaxable: 120_000,
    withdrawalsPreTax: 90_000,
    withdrawalsRoth: 50_000,
    shortfall: 400_000,
    totalSpending: 13_900_000,
    totalFunded: 13_500_000,
    reinvestedSurplus: 3_200_000,
  },
  fundingSources: [
    { label: "Social Security", value: 1_700_000 },
    { label: "Ongoing income", value: 240_000 },
    { label: "RMDs", value: 10_300_000 },
    { label: "Cash withdrawals", value: 1_000_000 },
    { label: "Taxable withdrawals", value: 120_000 },
    { label: "Pre-tax withdrawals", value: 90_000 },
    { label: "Roth withdrawals", value: 50_000 },
    { label: "Unfunded", value: 400_000, unfunded: true },
  ],
  socialSecurity: { client: ssClient("Rachel Sheskier"), spouse: ssClient("Daniel Sheskier") },
  living: { today: 100_000, retirement: 194_000 },
  otherExpenses: { insurance: 14_000, realEstate: 22_000, liabilities: 31_000, other: 0 },
  incomeEmptyCopy: "No income streams continue past retirement.",
  income: [
    { id: "i1", label: "Rental — Beacon St", type: "rental", amount: 42_000 },
    { id: "i2", label: "Consulting", type: "other", amount: 18_000 },
  ],
  transactions: [
    { year: 2061, name: "Beacon St", kind: "sale", amount: 1_250_000 },
    { year: 2066, name: "Lake house", kind: "purchase", amount: 700_000 },
  ],
  narrative: [
    "The plan has 82% plan confidence, ending with about $20.2M in liquid assets.",
    "Delaying Rachel Sheskier's Social Security from 67 to 70 would raise the monthly benefit by about 24%.",
    "Roth assets make up 5% of the retirement-year portfolio — a tax-free reserve for later-life or legacy needs.",
  ],
  fundingNarrative: [
    "Projected spending exceeds available funding by $400k over retirement — a shortfall the plan does not currently cover.",
    "RMDs is the largest funding source, covering 74% of lifetime retirement spending.",
  ],
  cashFlowChartSpec: chartSpec,
};

/** What a real deck prints: one Social Security ladder, a fully funded plan
 *  drawing on three sources, no optional expense/income/transaction rows. This
 *  is the shape that regressed into a blank page 8. */
const REPRESENTATIVE: RetirementSummaryPageData = {
  ...FULL,
  isMarried: false,
  socialSecurity: { client: FULL.socialSecurity.client, spouse: null },
  otherExpenses: { insurance: 0, realEstate: 0, liabilities: 0, other: 0 },
  income: [],
  transactions: [],
  funding: { ...FULL.funding, shortfall: 0, totalSpending: 13_500_000, totalFunded: 13_500_000 },
  fundingSources: [
    { label: "Social Security", value: 1_700_000 },
    { label: "RMDs", value: 10_300_000 },
    { label: "Cash withdrawals", value: 1_500_000 },
  ],
  narrative: [FULL.narrative[0], FULL.narrative[1], FULL.narrative[2]],
  fundingNarrative: [FULL.fundingNarrative[1]],
};

const FRAME = {
  firmName: "Ethos Financial Group",
  clientName: "Rachel & Daniel",
  reportDate: "August 31, 2026",
  pageIndex: 6,
  totalPages: 13,
  accent: DEFAULT_ACCENT,
};

async function pagesOf(data: RetirementSummaryPageData): Promise<Buffer> {
  ensureFontsRegistered();
  const buf = await renderToBuffer(<Document>{RetirementSummaryPagePdf({ data, ...FRAME })}</Document>);
  // `EMIT_PDF=/tmp/rs.pdf npx vitest run …` to look at what actually laid out.
  if (process.env.EMIT_PDF) writeFileSync(process.env.EMIT_PDF, buf);
  return buf;
}

describe("RetirementSummaryPagePdf render", () => {
  it("lays out a representative client on exactly the two sheets the estimate promises", async () => {
    expect(renderedPages(await pagesOf(REPRESENTATIVE))).toBe(2);
  });

  it("keeps the funding takeaway on the funding sheet, not repeated as sheet one's", async () => {
    const sheets = bodyTextPerSheet(await pagesOf(REPRESENTATIVE));
    expect(sheets[0]).toContain("plan confidence");
    expect(sheets[0]).not.toContain("largest funding source");
    expect(sheets[1]).toContain("largest funding source");
    expect(sheets[1]).not.toContain("plan confidence");
  });

  it("never emits a sheet carrying only the footer, even fully loaded", async () => {
    for (const [name, data] of [["representative", REPRESENTATIVE], ["full", FULL]] as const) {
      const sheets = bodyTextPerSheet(await pagesOf(data));
      sheets.forEach((body, i) => {
        expect(body, `${name}: sheet ${i + 1} of ${sheets.length} is blank`).not.toBe("");
      });
    }
  });

  it("renders the empty state without throwing", async () => {
    const buf = await pagesOf({ ...FULL, isEmpty: true });
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
