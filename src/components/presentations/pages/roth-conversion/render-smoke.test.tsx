import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { RothConversionPagePdf } from "./page-pdf";
import {
  estimateRothConversionPageCount,
  SCHEDULE_CONTINUED_ROWS,
  SCHEDULE_FIRST_SHEET_ROWS,
} from "@/lib/presentations/pages/roth-conversion/estimate-page-count";
import type {
  RothConversionPageData,
  RothConversionYearRow,
} from "@/lib/presentations/pages/roth-conversion/types";

const row = (year: number, over: Partial<RothConversionYearRow> = {}): RothConversionYearRow => ({
  year,
  clientAge: year - 1970,
  spouseAge: year - 1972,
  converted: 60_000,
  taxable: 60_000,
  extraTax: 12_150,
  bracket: 0.22,
  extraMedicare: 0,
  note: null,
  ...over,
});

function sample(years: number[]): RothConversionPageData {
  const schedule = years.map((y) => row(y));
  return {
    planLabel: "Roth Bridge Years",
    comparisonNote:
      "Compared with the same plan without these Roth conversions: same income, spending, retirement dates and returns.",
    emptyMessage: null,
    strategy: [
      `Convert $60,000 a year from John's IRA to John's Roth IRA, ${years[0]} through ${years[years.length - 1]}.`,
    ],
    totals: {
      converted: 60_000 * years.length,
      extraTax: 12_150 * years.length,
      laterTaxSaved: 41_000,
      extraMedicare: 2_400,
      heirsChange: 312_000,
    },
    breakeven: { kind: "year", year: 2043 },
    takeaway: [
      "Converting $300,000 to Roth from 2036 through 2040 adds about $61,000 to your tax bill in those years.",
      "From 2043 on, your family comes out ahead: by the end of the plan, your heirs receive about $312,000 more after tax.",
    ],
    schedule,
    showTaxable: false,
    showBracket: true,
    advantage: [2036, 2038, 2040, 2042, 2043, 2046, 2050, 2055].map((year, i) => ({
      year,
      value: [-8_000, -15_000, -20_000, -4_000, 6_000, 60_000, 150_000, 312_000][i],
    })),
    lifetime: [
      { label: "Tax over the plan", without: 812_000, with: 832_000, betterIsLower: true },
      { label: "Medicare surcharges", without: 18_000, with: 20_400, betterIsLower: true },
      { label: "Heirs receive, after tax", without: 4_120_000, with: 4_432_000, betterIsLower: false },
      { label: "Required withdrawal, 2045 (age 75)", without: 103_000, with: 61_000, betterIsLower: true },
    ],
    mix: {
      year: 2055,
      with: { roth: 1_400_000, preTax: 1_100_000, taxable: 300_000, total: 2_800_000 },
      without: { roth: 400_000, preTax: 2_100_000, taxable: 300_000, total: 2_800_000 },
    },
    rmd: { year: 2045, clientAge: 75, with: 61_000, without: 103_000 },
    footnotes: [
      "“Heirs receive” is what passes to your family after taxes and estate costs, including the 35% income tax heirs are assumed to pay when they withdraw from an inherited pre-tax account.",
      "Break-even is the first year from which your heirs would receive more after tax with the conversions than without.",
      "All amounts are in future dollars.",
    ],
  };
}

async function sheetsOf(data: RothConversionPageData): Promise<string[]> {
  ensureFontsRegistered();
  const buf = await renderToBuffer(
    <Document>
      {RothConversionPagePdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "John & Jane Smith",
        reportDate: "October 3, 2026",
        pageIndex: 4,
        totalPages: 9,
        accent: SECTION_ACCENTS["Income Tax"],
      })}
    </Document>,
  );
  const dir = mkdtempSync(join(tmpdir(), "roth-conv-"));
  try {
    const pdf = join(dir, "p.pdf");
    writeFileSync(pdf, buf);
    execFileSync("pdftotext", ["-layout", pdf, join(dir, "p.txt")]);
    return readFileSync(join(dir, "p.txt"), "utf8")
      .split("\f")
      .filter((p) => p.trim().length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FIVE = [2036, 2037, 2038, 2039, 2040];

describe("RothConversionPagePdf", () => {
  it("prints the strategy sheet and the year-by-year sheet, each stating the comparison", async () => {
    const sheets = await sheetsOf(sample(FIVE));
    expect(sheets).toHaveLength(2);
    for (const sheet of sheets) {
      expect(sheet).toContain("the same plan without these Roth conversions");
    }
    expect(sheets[0]).toContain("Roth Conversion Strategy");
    expect(sheets[1]).toContain("Roth Conversion — Year by Year");
  });

  it("puts the strategy, the five headline numbers and the takeaway on the first sheet", async () => {
    const [first] = await sheetsOf(sample(FIVE));
    expect(first).toContain("THE STRATEGY");
    expect(first).toContain("Convert $60,000 a year from John's IRA");
    for (const label of ["TOTAL CONVERTED", "TAX COST OF CONVERTING", "TAX SAVED AFTERWARD", "HEIRS RECEIVE", "BREAK-EVEN"]) {
      expect(first).toContain(label);
    }
    expect(first).toContain("$300k");
    expect(first).toContain("+$312k");
    expect(first).toContain("2043");
    expect(first).toContain("WHAT IT MEANS");
    expect(first).toContain("your heirs receive about $312,000 more after tax");
  });

  it("prints every conversion year, its tax and bracket, and a total", async () => {
    const [, second] = await sheetsOf(sample(FIVE));
    for (const y of FIVE) expect(second).toContain(String(y));
    expect(second).toContain("$12,150");
    expect(second).toContain("22%");
    expect(second).toContain("$300,000");
    expect(second).toContain("$60,750");
    expect(second).toContain("Required withdrawal, 2045");
    expect(second).toContain("Break-even 2043");
    expect(second).toContain("All amounts are in future dollars.");
  });

  it("fits the fullest first year-by-year sheet: every column, a note on every row", async () => {
    const years = Array.from({ length: SCHEDULE_FIRST_SHEET_ROWS }, (_, i) => 2030 + i);
    const data = sample(years);
    data.schedule = data.schedule.map((r, i) =>
      row(r.year, { taxable: 48_000, note: i % 2 ? "Held under the Medicare limit" : "Account emptied" }),
    );
    data.showTaxable = true;
    data.strategy.push(
      "Each year from 2041 through 2050, convert just enough from Jane's IRA to Jane's Roth IRA to fill the 24% tax bracket, keeping any Medicare surcharge at level 1 or below.",
    );
    const sheets = await sheetsOf(data);
    expect(sheets).toHaveLength(estimateRothConversionPageCount(data));
    expect(sheets).toHaveLength(2);
    expect(sheets[1]).toContain(String(years[years.length - 1]));
    expect(sheets[1]).toContain("TAXABLE PART");
    expect(sheets[1]).toMatch(/a\s+Account emptied/);
    expect(sheets[1]).toMatch(/b\s+Held under the Medicare limit/);
    expect(sheets[1]).toContain("All amounts are in future dollars.");
  });

  it("carries a long schedule onto a continuation sheet the page count already counted", async () => {
    const n = SCHEDULE_FIRST_SHEET_ROWS + SCHEDULE_CONTINUED_ROWS;
    const years = Array.from({ length: n }, (_, i) => 2030 + i);
    const data = sample(years);
    data.schedule = data.schedule.map((r) => row(r.year, { note: "Held under the Medicare limit" }));
    const sheets = await sheetsOf(data);
    expect(sheets).toHaveLength(estimateRothConversionPageCount(data));
    expect(sheets).toHaveLength(3);
    expect(sheets[1]).toContain("Continued on the next page.");
    expect(sheets[2]).toContain("continued");
    expect(sheets[2]).toContain(String(years[n - 1]));
    expect(sheets[2]).toContain("Total");
  });

  it("drops the Medicare column when nobody is on Medicare in any year it would cover", async () => {
    const data = sample(FIVE);
    data.schedule = data.schedule.map((r) => ({ ...r, extraMedicare: null }));
    const [, second] = await sheetsOf(data);
    expect(second).not.toContain("SURCHARGE");
    expect((await sheetsOf(sample(FIVE)))[1]).toContain("SURCHARGE");
  });

  it("prints the empty state on one sheet", async () => {
    const data: RothConversionPageData = {
      ...sample(FIVE),
      emptyMessage: "This plan has no Roth conversions, so there is nothing to compare.",
      totals: null,
      breakeven: null,
    };
    const sheets = await sheetsOf(data);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toContain("no Roth conversions");
    expect(sheets[0]).not.toContain("THE STRATEGY");
  });
});
