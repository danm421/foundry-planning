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
  subtitle: "Base Case · Today's dollars first · Future-year dollars beneath",
  liabilityName: "Student loan",
  monthlyAmount: 500,
  milestoneAge: 65,
  milestoneYear: 2062,
  loan: {
    label: "Onto the loan",
    debtFreeYear: 2032,
    interestPaid: { today: 6_600, nominal: 7_200 },
    portfolioAtMilestone: { today: 930_000, nominal: 2_694_000 },
  },
  invest: {
    label: "Into the 401(k)",
    debtFreeYear: 2036,
    interestPaid: { today: 14_000, nominal: 17_800 },
    portfolioAtMilestone: { today: 985_000, nominal: 2_853_000 },
  },
  detailRows: [
    { year: 2026, age: 29, loanBalance: { today: 30_000, nominal: 30_000 }, investBalance: { today: 30_000, nominal: 30_000 } },
    { year: 2032, age: 35, loanBalance: { today: 0, nominal: 0 }, investBalance: { today: 25_000, nominal: 29_851 } },
    { year: 2062, age: 65, loanBalance: { today: 0, nominal: 0 }, investBalance: { today: 0, nominal: 0 } },
  ],
  takeaway: 'By age 65, "Into the 401(k)" leaves about $55K today ($159K in 2062 dollars) more.',
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
    expect(text).toContain("$2,694,000 in 2062");
    expect(text).toContain("$29,851 in 2032");
  });

  it("says on the sheet that the extra payment costs real money too", async () => {
    const text = flat(await textOf(base));
    expect(text).toContain("money out the door");
    // The loan arm's extras stop at ITS payoff, not at the base plan's — the
    // sheet says so rather than claiming both arms spend for the same years.
    expect(text).toContain("stop the moment the loan clears");
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
