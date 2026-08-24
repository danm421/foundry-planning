import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { EarlyYearsStandingPagePdf } from "./page-pdf";
import type { EarlyYearsStandingPageData } from "@/lib/presentations/pages/early-years-standing/types";

const base: EarlyYearsStandingPageData = {
  isEmpty: false,
  subtitle: "Base Case · At age 29 · Starting year 2026",
  clientAge: 29,
  basis: { inflationRate: 0.025, planStartYear: 2026 },
  grossAnnual: { today: 120_000, nominal: 120_000 },
  contributionsAnnual: { today: 9_600, nominal: 9_600 },
  savingsRatePct: 0.08,
  portfolio: { today: 84_000, nominal: 84_000 },
  match: { kind: "captured", employerAnnual: { today: 3_600, nominal: 3_600 } },
  tidbits: [
    {
      id: "compounding-runway",
      title: "Time is the ingredient you can't buy later",
      body: "A dollar saved in your twenties has decades to double and double again.",
      topic: "compounding",
    },
  ],
};

function render(data: EarlyYearsStandingPageData) {
  ensureFontsRegistered();
  return renderToBuffer(
    <Document>
      {EarlyYearsStandingPagePdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "Cooper Sample",
        reportDate: "June 10, 2026",
        pageIndex: 1,
        totalPages: 1,
        accent: SECTION_ACCENTS["Early Years"],
      })}
    </Document>,
  );
}

/**
 * The text the sheet actually prints, via `pdftotext`. Byte length alone cannot
 * see a sentence, so the page's own claims — the rate, the match line, the
 * today's-dollars label — are read back off the rendered bytes. Requires poppler
 * on PATH (`brew install poppler`) and says so rather than skipping itself.
 */
function inspectPdf(pdf: Buffer): { text: string; layout: string; bbox: string } {
  const dir = mkdtempSync(join(tmpdir(), "early-years-standing-"));
  const file = join(dir, "sheet.pdf");
  try {
    writeFileSync(file, pdf);
    try {
      return {
        text: execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }),
        layout: execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }),
        bbox: execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" }),
      };
    } catch (cause) {
      throw new Error(
        "this assertion needs `pdftotext` (poppler) on PATH — `brew install poppler`",
        { cause },
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function pdfText(pdf: Buffer): string {
  return inspectPdf(pdf).text;
}

describe("EarlyYearsStandingPagePdf render", () => {
  it("renders to a non-trivial PDF buffer", async () => {
    expect((await render(base)).byteLength).toBeGreaterThan(1000);
  });

  it("fills one sheet to a measured depth without repeating the portfolio value", async () => {
    const { text: extracted, layout, bbox } = inspectPdf(await render(base));
    const text = extracted.replace(/\s+/g, " ");
    const pages = layout.split("\f").filter((part) => part.trim().length > 0);
    // "prices," appears once, inside the reading-the-dollars panel — the
    // page's bottom-most block. Its depth is what proves the panel filled the
    // sheet without running under the footer.
    const unitProofBottoms = [...bbox.matchAll(
      /<word xMin="[\d.-]+" yMin="[\d.-]+" xMax="[\d.-]+" yMax="([\d.-]+)">prices,<\/word>/g,
    )].map((match) => Number(match[1]));

    expect(text).toContain("8%");
    expect(text).toContain("Your employer adds $3,600 a year");
    expect(text).toContain("Every figure is in today's dollars");
    expect(text).toContain("Time is the ingredient you can't buy later");
    expect(text).not.toContain("One number, two views");
    expect(text).not.toContain("Today's dollars = future-year dollars");
    expect(text.match(/\$84,000/g)).toHaveLength(1);
    expect(pages).toHaveLength(1);
    expect(unitProofBottoms).not.toHaveLength(0);
    expect(Math.max(...unitProofBottoms)).toBeGreaterThanOrEqual(600);
    expect(Math.max(...unitProofBottoms)).toBeLessThan(720);
  });

  // The panel's whole job is telling the client what "today's dollars" means and
  // at what rate. A generic 3% would be a claim about a number this plan may not
  // use, so the rate is read back off the rendered sheet.
  it("names the plan's own inflation rate and basis year, not a generic one", async () => {
    const text = pdfText(await render(base)).replace(/\s+/g, " ");
    expect(text).toContain("at 2026 prices");
    expect(text).toContain("inflation assumption of 2.5% a year");
    expect(
      pdfText(
        await render({ ...base, basis: { ...base.basis, inflationRate: 0.03 } }),
      ).replace(/\s+/g, " "),
    ).toContain("inflation assumption of 3% a year");
  });

  it("renders without a match line or tidbits", async () => {
    const text = pdfText(await render({ ...base, match: { kind: "none" }, tidbits: [] }));
    expect(text).not.toContain("employer adds");
    expect(text).not.toContain("Time is the ingredient");
  });

  it("renders the empty state without throwing", async () => {
    const text = pdfText(await render({ ...base, isEmpty: true })).replace(/\s+/g, " ");
    expect(text).toContain("no salary income in its first year");
    // The empty state must not still print the figures it cannot stand behind.
    expect(text).not.toContain("8%");
  });
});
