import { describe, expect, it } from "vitest";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import type { ClientData, Liability } from "@/engine/types";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { SHORT_DISCLAIMER } from "@/lib/presentations/disclaimers";
import { BBOX_EPS, renderedPages, wordBoxes } from "@/components/presentations/shared/test-utils/pdf-bbox";
import {
  FIRST_SHEET_ROWS,
  NEXT_SHEET_ROWS,
  buildLiabilityAmortizationData,
  estimateLiabilityAmortizationPageCount,
} from "@/lib/presentations/pages/liability-amortization/view-model";
import type { LiabilityAmortizationPageData } from "@/lib/presentations/pages/liability-amortization/types";
import { LiabilityAmortizationPagePdf } from "./page-pdf";

const TODAY = new Date(2026, 9, 8);
/** Letter is 792pt tall and the frame keeps 72pt clear for its footer. */
const CONTENT_BOTTOM = 792 - 72;

function loan(over: Partial<Liability>): Liability {
  return {
    id: "loan",
    name: "Loan",
    balance: 100_000,
    interestRate: 0.06,
    monthlyPayment: 1_000,
    startYear: 2020,
    startMonth: 1,
    termMonths: 360,
    extraPayments: [],
    owners: [],
    ...over,
  };
}

// The longest first sheet (forgiveness footnote, Extra column) and the longest
// continuation sheet the pagination allows, plus an ordinary mortgage.
const LOANS: Liability[] = [
  loan({ id: "mortgage", name: "Primary residence mortgage", balance: 412_000, interestRate: 0.065, monthlyPayment: 2_844, startYear: 2020, startMonth: 7 }),
  loan({
    id: "student",
    name: "Student loan",
    balance: 61_000,
    interestRate: 0.068,
    monthlyPayment: 420,
    startYear: 2015,
    termMonths: 300,
    forgiveAtTermEnd: true,
    extraPayments: [{ id: "ep", liabilityId: "student", year: 2027, type: "lump_sum", amount: 5_000 }],
  }),
  // 19 rows + totals + footnote: one first sheet filled exactly to capacity.
  loan({ id: "plus", name: "Parent PLUS loan", balance: 58_000, interestRate: 0.068, monthlyPayment: 380, startYear: 2020, termMonths: 228, forgiveAtTermEnd: true }),
  // Interest-free, so the payment runs the full 75-year term: 75 rows.
  loan({ id: "long", name: "Intra-family note", balance: 900_000, interestRate: 0, monthlyPayment: 1_300, startYear: 2010, termMonths: 900 }),
];

async function render(data: LiabilityAmortizationPageData): Promise<Buffer> {
  ensureFontsRegistered();
  return renderToBuffer(
    <Document>
      {LiabilityAmortizationPagePdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "Cooper & Avery",
        reportDate: "October 8, 2026",
        pageIndex: 3,
        totalPages: 9,
        accent: SECTION_ACCENTS.Assets,
      })}
    </Document>,
  );
}

const FOOTER_WORDS = new Set(
  `${SHORT_DISCLAIMER} Confidential · Personal Page of`.split(/\s+/),
);

describe("Loan Amortization sheet geometry", () => {
  const data = buildLiabilityAmortizationData(
    { liabilities: LOANS } as unknown as ClientData,
    { liabilityIds: null },
    "Base Case",
    TODAY,
  );

  it("fills a first sheet and a continuation sheet to the planned row counts", () => {
    const long = data.loans.find((l) => l.liabilityId === "long")!;
    expect(long.sheets.map((s) => s.length)).toEqual([FIRST_SHEET_ROWS, NEXT_SHEET_ROWS, expect.any(Number)]);
    const student = data.loans.find((l) => l.liabilityId === "student")!;
    expect(student.footnote).toMatch(/forgiven in 2039/);
    const plus = data.loans.find((l) => l.liabilityId === "plus")!;
    expect(plus.sheets.map((s) => s.length)).toEqual([FIRST_SHEET_ROWS - 3]);
    expect(plus.footnote).not.toBeNull();
  });

  it("prints exactly the sheets the deck plans for, with nothing in the footer band", async () => {
    const pdf = await render(data);
    const planned = estimateLiabilityAmortizationPageCount(data);
    expect(renderedPages(pdf)).toBe(planned);

    for (let page = 1; page <= planned; page++) {
      const intruders = wordBoxes(pdf, page).filter(
        (w) => w.yMax > CONTENT_BOTTOM + BBOX_EPS && !FOOTER_WORDS.has(w.text) && !/^\d+$/.test(w.text),
      );
      expect(intruders, `sheet ${page}`).toEqual([]);
    }
  });

  it("prints the Extra column only for a loan with an extra payment", async () => {
    const pdf = await render(data);
    let page = 1;
    for (const l of data.loans) {
      for (let s = 0; s < l.sheets.length; s++, page++) {
        const hasExtra = wordBoxes(pdf, page).some((w) => w.text === "Extra");
        expect(hasExtra, `${l.name} sheet ${s + 1}`).toBe(l.totals.extraPayment > 0);
      }
    }
  });

  it("puts every schedule year on the sheet it was planned for", async () => {
    const pdf = await render(data);
    let page = 1;
    for (const l of data.loans) {
      for (const rows of l.sheets) {
        const words = new Set(wordBoxes(pdf, page).map((w) => w.text));
        for (const r of rows) expect(words.has(String(r.year)), `${l.name} ${r.year} on sheet ${page}`).toBe(true);
        page++;
      }
    }
  });
});
