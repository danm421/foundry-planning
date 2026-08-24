import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { EarlyYearsRothPagePdf, betterColumn } from "./page-pdf";
import type { EarlyYearsRothPageData } from "@/lib/presentations/pages/early-years-roth/types";

const base: EarlyYearsRothPageData = {
  subtitle: "Base Case · Today's dollars first · Future-year dollars beneath",
  rows: [
    { label: "Tax paid while you're working", traditional: { today: 612_000, nominal: 850_000 }, roth: { today: 741_000, nominal: 1_020_000 }, betterIsLower: true },
    { label: "Tax paid from retirement on", traditional: { today: 388_000, nominal: 940_000 }, roth: { today: 106_000, nominal: 260_000 }, betterIsLower: true },
    { label: "Tax over the whole plan", traditional: { today: 1_000_000, nominal: 1_790_000 }, roth: { today: 847_000, nominal: 1_280_000 }, betterIsLower: true },
    { label: "Average yearly spending in retirement", traditional: { today: 72_000, nominal: 141_000 }, roth: { today: 72_000, nominal: 141_000 }, betterIsLower: false },
  ],
  detailRows: [
    { year: 2026, age: 29, traditionalTax: { today: 20_000, nominal: 20_000 }, rothTax: { today: 24_000, nominal: 24_000 } },
    { year: 2062, age: 65, traditionalTax: { today: 8_000, nominal: 23_175 }, rothTax: { today: 3_000, nominal: 8_691 } },
    { year: 2067, age: 70, traditionalTax: { today: 8_000, nominal: 26_859 }, rothTax: { today: 3_000, nominal: 10_072 } },
  ],
  takeaway: "Over the whole plan, all-Roth contributions leave about $153,000 today ($510,000 future-year dollars) less tax paid.",
  spendingIsFixed: true,
  emptyMessage: null,
  tidbits: [],
};

async function textOf(data: EarlyYearsRothPageData): Promise<string> {
  ensureFontsRegistered();
  const buf = await renderToBuffer(
    <Document>
      {EarlyYearsRothPagePdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "Cooper Sample",
        reportDate: "August 20, 2026",
        pageIndex: 6,
        totalPages: 8,
        accent: SECTION_ACCENTS["Early Years"],
      })}
    </Document>,
  );
  const dir = mkdtempSync(join(tmpdir(), "roth-"));
  try {
    const pdf = join(dir, "p.pdf");
    writeFileSync(pdf, buf);
    execFileSync("pdftotext", ["-layout", pdf, join(dir, "p.txt")]);
    return readFileSync(join(dir, "p.txt"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("EarlyYearsRothPagePdf", () => {
  it("prints both column headings and all four rows", async () => {
    const text = await textOf(base);
    // The heading style is textTransform: "uppercase", so this is what the
    // sheet actually prints — asserting the source casing passes on nothing.
    expect(text).toContain("ALL TRADITIONAL");
    expect(text).toContain("ALL ROTH");
    expect(text).toContain("Tax over the whole plan");
    expect(text).toContain("Average yearly spending in retirement");
    expect(text).toContain("$1,790,000 future-year dollars");
    expect(text).toContain("$26,859 future-year dollars");
  });

  it("explains a plan whose spending cannot move", async () => {
    expect(await textOf(base)).toContain("fixed amount each year");
    expect(await textOf({ ...base, spendingIsFixed: false })).not.toContain("fixed amount each year");
  });

  it("prints the flat-tax-mode empty state and no table", async () => {
    const text = await textOf({
      ...base,
      rows: [],
      emptyMessage:
        "This comparison is only meaningful on the bracket tax engine — the flat-rate setting doesn't model the deduction a pre-tax contribution earns. Switch the plan's tax engine to brackets to print this page.",
    });
    expect(text).toContain("bracket tax engine");
    expect(text).not.toContain("ALL ROTH");
  });

  // `estimateEarlyYearsRothPageCount` promises one sheet for the fullest
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
    expect(text).toContain("Tax over the whole plan");
    // pdftotext emits a form feed per page; the sidebar must not push a second.
    expect(text.split("\f").filter((p) => p.trim().length > 0)).toHaveLength(1);
  });
});

describe("betterColumn", () => {
  const row = (traditional: number, roth: number, betterIsLower: boolean) => ({
    label: "x",
    traditional: { today: traditional, nominal: traditional },
    roth: { today: roth, nominal: roth },
    betterIsLower,
  });

  it("marks the smaller figure on a tax row, in both directions", () => {
    expect(betterColumn(row(612_000, 741_000, true))).toBe("traditional");
    expect(betterColumn(row(741_000, 612_000, true))).toBe("roth");
  });

  it("marks the LARGER figure on the spending row, in both directions", () => {
    expect(betterColumn(row(74_000, 72_000, false))).toBe("traditional");
    expect(betterColumn(row(72_000, 74_000, false))).toBe("roth");
  });

  it("marks neither column on a tie", () => {
    expect(betterColumn(row(72_000, 72_000, false))).toBeNull();
    expect(betterColumn(row(72_000, 72_000, true))).toBeNull();
  });
});
