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
  subtitle: "Base Case · At age 29 · Today's dollars equal future-year dollars",
  clientAge: 29,
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
function pdfText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "early-years-standing-"));
  const file = join(dir, "sheet.pdf");
  try {
    writeFileSync(file, pdf);
    try {
      return execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
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

describe("EarlyYearsStandingPagePdf render", () => {
  it("renders to a non-trivial PDF buffer", async () => {
    expect((await render(base)).byteLength).toBeGreaterThan(1000);
  });

  it("prints the savings rate, match, tidbit and a visible current-year unit proof", async () => {
    const text = pdfText(await render(base)).replace(/\s+/g, " ");
    expect(text).toContain("8%");
    expect(text).toContain("Your employer adds $3,600 a year");
    expect(text).toContain("Today's dollars equal future-year dollars");
    expect(text).toContain("$84,000 today = $84,000 future-year dollars");
    expect(text).toContain("Time is the ingredient you can't buy later");
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
