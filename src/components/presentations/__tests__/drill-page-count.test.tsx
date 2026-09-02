// src/components/presentations/__tests__/drill-page-count.test.tsx
//
// `estimateDrillPageCount` runs BEFORE react-pdf lays anything out, and the
// deck's Contents takes every page number from it. When it is wrong the page
// still prints correctly — its own footer carries the true number — so nothing
// complains and the Contents quietly sends the reader to the wrong sheet. It
// hard-returned 1 for every drill page while a table of one row per projection
// year ran to two, which is half of why an audited client deck listed
// "Tax Comparison … 13" for a sheet that printed on 18.
//
// The only test worth having renders the real page and counts the sheets
// react-pdf actually produced. Every constant in the estimator is pinned here,
// against the registry's own pages rather than a hand-built stand-in — a
// stand-in has its own chart height and its own footnote, and would pin numbers
// the product never uses.
import { describe, it, expect } from "vitest";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DrillPagePdf } from "../shared/drill-page-pdf";
import { ensureFontsRegistered } from "../shared/fonts";
import { PRESENTATION_PAGES } from "../registry";
import { SECTION_ACCENTS, DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { estimateDrillPageCount } from "@/lib/presentations/shared/drill-options";
import type { DrillPageData } from "@/lib/presentations/shared/drill-types";
import type { ClientData, ProjectionYear } from "@/engine/types";

ensureFontsRegistered();

/** Enough of a projection for the drill builders to run. The figures do not
 *  matter — the ROW COUNT does. Long enough to outrun three sheets. */
const YEARS = Array.from({ length: 110 }, (_, i) => ({
  year: 2026 + i,
  ages: { client: 40 + i, spouse: null },
  portfolioAssets: {
    liquidTotal: 1_000_000, cashTotal: 100_000, taxableTotal: 500_000,
    retirementTotal: 400_000, cash: {}, taxable: {}, retirement: {}, total: 1_000_000,
  },
  accountLedgers: {},
  income: {
    salaries: 90_000, socialSecurity: 0, business: 0, deferred: 0,
    capitalGains: 0, trust: 0, other: 0, total: 90_000, bySource: {},
  },
  withdrawals: { byAccount: {}, total: 0 },
  expenses: { living: 60_000, insurance: 0, realEstate: 0, liabilities: 0, other: 0, total: 60_000, bySource: {} },
  savings: { total: 0, byAccount: {} },
  growth: { total: 0, byAccount: {} },
  taxes: {
    federal: 12_000, state: 3_000, fica: 6_000, capitalGains: 0,
    totalTax: 21_000, taxableIncome: 78_000, effectiveRate: 0.23, marginalRate: 0.22,
  },
  totalIncome: 90_000, totalExpenses: 60_000, netCashFlow: 30_000,
})) as unknown as ProjectionYear[];

const CLIENT_DATA = {
  planSettings: { planStartYear: 2026, inflationRate: 0.03 },
  client: {
    firstName: "Cooper", currentAge: 40, retirementAge: 65,
    dateOfBirth: "1986-01-01", spouseDob: null, spouseRetirementAge: null,
  },
  liabilities: [], savingsRules: [], incomes: [], expenses: [], accounts: [],
} as unknown as ClientData;

type DrillId = "cashFlowIncome" | "cashFlowExpenses" | "cashFlowAssets";

/** A real drill page's data, its table stretched to `rows` by repeating the
 *  builder's own rows — so the chart, columns and footnote are the real ones. */
function build(id: DrillId, rows: number, over: Partial<DrillPageData> = {}): DrillPageData {
  const page = PRESENTATION_PAGES[id];
  const base = page.buildData(
    {
      years: YEARS, clientData: CLIENT_DATA, scenarioLabel: "Base Case",
      clientName: "Cooper", spouseName: null,
    } as never,
    page.defaultOptions as never,
  ) as DrillPageData;
  expect(base.table.rows.length, `${id} built no rows`).toBeGreaterThan(0);
  return {
    ...base,
    ...over,
    table: {
      ...base.table,
      ...over.table,
      rows: Array.from({ length: rows }, (_, i) => ({
        ...base.table.rows[i % base.table.rows.length],
        year: 2026 + i,
      })),
    },
  };
}

/** Sheets react-pdf actually laid out — pdftotext emits a form feed per page. */
async function renderedSheets(d: DrillPageData, category: string): Promise<number> {
  const buf = await renderToBuffer(
    <Document>
      {DrillPagePdf({
        data: d, firmName: "Ethos Financial Group", clientName: "Cooper Sample",
        reportDate: "September 2, 2026", pageIndex: 1, totalPages: 1,
        accent: SECTION_ACCENTS[category] ?? DEFAULT_ACCENT,
      })}
    </Document>,
  );
  const dir = mkdtempSync(join(tmpdir(), "drill-"));
  try {
    const pdf = join(dir, "d.pdf");
    writeFileSync(pdf, buf);
    execFileSync("pdftotext", ["-layout", pdf, join(dir, "d.txt")]);
    const parts = readFileSync(join(dir, "d.txt"), "utf8").split("\f");
    if (parts.at(-1)?.trim() === "") parts.pop();
    return parts.length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function expectAgrees(id: DrillId, d: DrillPageData, label: string) {
  const actual = await renderedSheets(d, PRESENTATION_PAGES[id].category);
  expect(
    estimateDrillPageCount(d),
    `${label}: estimated ${estimateDrillPageCount(d)}, rendered ${actual}`,
  ).toBe(actual);
}

const CALLOUT_ONE_LINE = "Withdrawals stay inside the 22% bracket every year of retirement.";
const CALLOUT_THREE_LINES =
  "This scenario holds spending flat in real terms, funds the shortfall from the brokerage account, and assumes the rental property is sold in 2041 with the proceeds reinvested into the taxable portfolio at the household's blended allocation, net of capital gains tax.";

describe("estimateDrillPageCount matches the sheets react-pdf renders", () => {
  it("counts a full-length projection table as the two sheets it prints", async () => {
    // The defect, at the size it shipped: 33 projection years.
    const d = build("cashFlowIncome", 33);
    expect(await renderedSheets(d, "Cash Flow")).toBe(2);
    expect(estimateDrillPageCount(d)).toBe(2);
  }, 60_000);

  // Sweeps straddling every break the layout has. An estimate that is merely
  // close still mis-numbers the Contents, so both sides of each are checked.
  it.each([
    ["cashFlowIncome", [1, 5, 19, 20, 21, 22, 33, 40]],
    ["cashFlowExpenses", [19, 20, 21, 22]],
    ["cashFlowAssets", [18, 19, 20, 21, 22]],
  ] as Array<[DrillId, number[]]>)("%s: agrees at every row count near a break", async (id, counts) => {
    for (const n of counts) await expectAgrees(id, build(id, n), `${id} ${n} rows`);
  }, 120_000);

  it("keeps counting past the second sheet", async () => {
    // A long plan — early retirement, life expectancy 100 — outruns two sheets,
    // and a table ending flush at the bottom prints one more sheet carrying
    // nothing but the footnote.
    for (const n of [63, 64, 65, 66, 108, 109]) {
      await expectAgrees("cashFlowIncome", build("cashFlowIncome", n), `${n} rows`);
    }
  }, 180_000);

  it("leaves room for an advisor's callout", async () => {
    for (const n of [15, 16, 17, 18]) {
      await expectAgrees("cashFlowIncome", build("cashFlowIncome", n, { callout: CALLOUT_ONE_LINE }), `1-line callout, ${n} rows`);
      await expectAgrees("cashFlowIncome", build("cashFlowIncome", n, { callout: CALLOUT_THREE_LINES }), `3-line callout, ${n} rows`);
    }
  }, 180_000);

  it("gives a table-only drill its extra rows", async () => {
    // Not every drill has a chart; the page falls back to a table-only layout,
    // which fits roughly twice as many rows before it breaks.
    for (const n of [37, 38, 39, 40]) {
      await expectAgrees("cashFlowIncome", build("cashFlowIncome", n, { chartSpec: undefined }), `no chart, ${n} rows`);
    }
  }, 120_000);

  it("answers 1 for the registry's data-free probe and for an empty table", () => {
    expect(estimateDrillPageCount()).toBe(1);
    expect(estimateDrillPageCount(build("cashFlowIncome", 0))).toBe(1);
  });
});
