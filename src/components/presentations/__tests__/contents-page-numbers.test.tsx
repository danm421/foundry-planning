// src/components/presentations/__tests__/contents-page-numbers.test.tsx
//
// The Contents page is numbered from `estimatePageCount`, which runs BEFORE
// react-pdf lays anything out. When an estimate is wrong the deck still prints
// fine — the footer's page number is the real one — so nothing complains and
// the Contents quietly points at the wrong sheet. Worse, two estimates wrong in
// opposite directions cancel, which is how a client deck shipped with
// "Tax Summary … 8" (it was 9) while the two entries after it were right.
//
// The only way to catch that is to render the deck and read the sheets back.
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PresentationDocument } from "../document";
import type { PageScenarioBundle } from "../document";
import type { PresentationPageId } from "../registry";

/** Enough of a ProjectionYear for every page in DECK to build without throwing.
 *  The figures do not matter — the sheet COUNT does. */
const YEARS = Array.from({ length: 40 }, (_, i) => ({
  year: 2026 + i,
  ages: { client: 29 + i, spouse: null },
  portfolioAssets: {
    liquidTotal: 1_000_000, cashTotal: 100_000, taxableTotal: 500_000, retirementTotal: 400_000,
    cash: {}, taxable: {}, retirement: {},
  },
  accountLedgers: {},
  income: {
    salaries: 90_000, socialSecurity: 0, business: 0, deferred: 0,
    capitalGains: 0, trust: 0, other: 0, total: 90_000, bySource: {},
  },
  withdrawals: { byAccount: {}, total: 0 },
  expenses: { living: 60_000, insurance: 0, realEstate: 0, liabilities: 0, other: 0, total: 60_000 },
  savings: { total: 0 },
  taxes: {
    federal: 12_000, state: 3_000, fica: 6_000, capitalGains: 0,
    totalTax: 21_000, taxableIncome: 78_000, effectiveRate: 0.23, marginalRate: 0.22,
  },
  totalIncome: 90_000,
  totalExpenses: 60_000,
  netCashFlow: 30_000,
}));

const bundle = (): PageScenarioBundle =>
  ({
    clientData: {
      planSettings: { planStartYear: 2026, inflationRate: 0.03 },
      client: {
        firstName: "Cooper", currentAge: 29, retirementAge: 65,
        dateOfBirth: "1997-01-01", spouseDob: null, spouseRetirementAge: null,
      },
      liabilities: [],
      savingsRules: [],
      incomes: [],
      expenses: [],
      accounts: [],
    },
    projection: { years: YEARS },
    scenarioLabel: "Base Case",
  }) as unknown as PageScenarioBundle;

function doc(pageIds: PresentationPageId[]) {
  return PresentationDocument({
    pages: pageIds.map((pageId) => ({ pageId, scenarioKey: "base" })),
    firmName: "Ethos Financial Group",
    firmTagline: null,
    firmLogoDataUrl: null,
    accentColor: "#b08d3f",
    clientName: "Cooper Sample",
    reportDate: "August 20, 2026",
    spouseName: null,
    spouseLastName: null,
    headerName: "Cooper",
    bundles: { base: bundle() },
    topScenarioKey: "base",
  });
}

/** One string per rendered sheet, in order. `pdftotext` emits a form feed
 *  between pages, and a trailing one after the last. */
async function sheetsOf(element: ReturnType<typeof doc>): Promise<string[]> {
  const buf = await renderToBuffer(element);
  const dir = mkdtempSync(join(tmpdir(), "toc-"));
  try {
    const pdf = join(dir, "d.pdf");
    writeFileSync(pdf, buf);
    execFileSync("pdftotext", ["-layout", pdf, join(dir, "d.txt")]);
    const text = readFileSync(join(dir, "d.txt"), "utf8");
    const parts = text.split("\f");
    if (parts.at(-1)?.trim() === "") parts.pop();
    return parts;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The Contents entries, as the reader sees them: a title, then the sheet it
 *  sends them to. Dot leaders are not printed, so the number is simply the
 *  last token on the line. */
function contentsEntries(tocSheet: string): Array<{ title: string; page: number }> {
  const entries: Array<{ title: string; page: number }> = [];
  for (const raw of tocSheet.split("\n")) {
    const line = raw.trim().replace(/\s+/g, " ");
    const m = /^(.*[^\s\d])\s+(\d+)$/.exec(line);
    if (!m) continue;
    if (/^Page \d+ of \d+$/.test(line)) continue;
    entries.push({ title: m[1].trim(), page: Number(m[2]) });
  }
  return entries;
}

// Every page in the audited client deck, in its order. Two of them print more
// than one sheet, which is exactly where the numbering used to drift.
const DECK: PresentationPageId[] = [
  "cover",
  "toc",
  "clientProfile",
  "balanceSheet",
  "retirementSummary",
  "taxSummary",
  "scenarioChanges",
  "retirementComparison",
  "taxComparison",
];

describe("Contents page numbers", () => {
  it("sends the reader to the sheet the entry names", async () => {
    const sheets = await sheetsOf(doc(DECK));
    const entries = contentsEntries(sheets[1]);

    // Cover Sheet plus one line per titled sheet of every other page.
    expect(entries.length).toBeGreaterThan(DECK.length - 2);

    for (const { title, page } of entries) {
      expect(page, `"${title}" points past the end of a ${sheets.length}-sheet deck`)
        .toBeLessThanOrEqual(sheets.length);
      // The cover prints the client's name, not the words "Cover Sheet" — its
      // Contents line is a label for sheet 1, not a heading to match.
      if (title === "Cover Sheet") {
        expect(page).toBe(1);
        continue;
      }
      // The sheet's own heading may carry a suffix ("Balance Sheet | Today"),
      // so the Contents title has to be a prefix of what the sheet prints.
      expect(sheets[page - 1], `Contents sends "${title}" to sheet ${page}`).toContain(title);
    }
  });

  it("lists the second sheet of a two-sheet page under its own name", async () => {
    const sheets = await sheetsOf(doc(DECK));
    const entries = contentsEntries(sheets[1]);
    const titles = entries.map((e) => e.title);
    expect(titles).toContain("Retirement Summary");
    expect(titles).toContain("Income, Spending & Funding");
    const summary = entries.find((e) => e.title === "Retirement Summary")!;
    const funding = entries.find((e) => e.title === "Income, Spending & Funding")!;
    expect(funding.page).toBe(summary.page + 1);
  });
});
