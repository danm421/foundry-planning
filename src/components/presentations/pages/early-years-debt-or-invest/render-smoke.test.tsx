import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { EarlyYearsDebtOrInvestPagePdf } from "./page-pdf";
import type { EarlyYearsDebtOrInvestPageData } from "@/lib/presentations/pages/early-years-debt-or-invest/types";

const base: EarlyYearsDebtOrInvestPageData = {
  subtitle: "Base Case · Every figure in today's dollars",
  liabilityName: "Student loan",
  monthlyAmount: 500,
  milestoneAge: 65,
  loan: {
    label: "Onto the loan",
    debtFreeYear: 2032,
    interestPaid: 6_600,
    portfolioAtMilestone: 930_000,
  },
  invest: {
    label: "Into the 401(k)",
    debtFreeYear: 2036,
    interestPaid: 14_000,
    portfolioAtMilestone: 985_000,
  },
  takeaway: 'By age 65, "Into the 401(k)" leaves about $55K more, in today\'s dollars.',
  emptyMessage: null,
  tidbits: [],
};

async function textOf(data: EarlyYearsDebtOrInvestPageData): Promise<string> {
  ensureFontsRegistered();
  const buf = await renderToBuffer(
    <Document>
      {EarlyYearsDebtOrInvestPagePdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "Cooper Sample",
        reportDate: "August 20, 2026",
        pageIndex: 7,
        totalPages: 8,
        accent: SECTION_ACCENTS["Early Years"],
      })}
    </Document>,
  );
  const dir = mkdtempSync(join(tmpdir(), "debt-or-invest-"));
  try {
    const pdf = join(dir, "p.pdf");
    writeFileSync(pdf, buf);
    execFileSync("pdftotext", ["-layout", pdf, join(dir, "p.txt")]);
    return readFileSync(join(dir, "p.txt"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `-layout` wraps the footnote and the lede, so a sentence-length assertion
 *  has to read the text as one run rather than as laid-out lines. */
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("EarlyYearsDebtOrInvestPagePdf", () => {
  it("prints both arms, all three figures and the loan's name", async () => {
    const text = await textOf(base);
    expect(text).toContain("Onto the loan");
    expect(text).toContain("Into the 401(k)");
    expect(text).toContain("Student loan");
    expect(text).toContain("2032");
    expect(text).toContain("$930,000");
  });

  it("says on the sheet that both choices spend the same money", async () => {
    expect(flat(await textOf(base))).toContain("same money over the same years");
  });

  it("prints the empty state rather than one column", async () => {
    const text = await textOf({
      ...base,
      loan: null,
      invest: null,
      emptyMessage: "This comparison could not be built for this plan.",
    });
    expect(flat(text)).toContain("could not be built");
    // The string the full render prints as the first card's title — so this one
    // assertion carries both verdicts, present with arms and absent without.
    expect(text).not.toContain("Onto the loan");
  });

  // `estimateEarlyYearsDebtOrInvestPageCount` promises one sheet for the fullest
  // version of this page. Nothing else holds it to that.
  it("still fits on one sheet beside two tidbits", async () => {
    const text = await textOf({
      ...base,
      tidbits: [
        {
          id: "compounding-runway",
          title: "Time is the ingredient you can't buy later",
          body: "A dollar saved in your twenties has decades to double and double again. The same dollar saved at fifty gets one or two doublings.",
          topic: "compounding",
        },
        {
          id: "compounding-automate",
          title: "Automate it once, benefit every month",
          body: "A contribution set to happen automatically turns compounding from a decision you make every month into one you made once.",
          topic: "compounding",
        },
      ],
    });
    expect(text).toContain("Time is the ingredient");
    expect(text).toContain("Into the 401(k)");
    // pdftotext emits a form feed per page; the sidebar must not push a second.
    expect(text.split("\f").filter((p) => p.trim().length > 0)).toHaveLength(1);
  });
});
