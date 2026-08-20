import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { EarlyYearsLadderPagePdf } from "./page-pdf";
import type { EarlyYearsLadderPageData } from "@/lib/presentations/pages/early-years-ladder/types";

const rungs = [
  { percent: 0.08, label: "Save 8%", isCurrent: true },
  { percent: 0.11, label: "Save 11%", isCurrent: false },
  { percent: 0.14, label: "Save 14%", isCurrent: false },
];

const group = (age: number, values: number[]) => ({
  age,
  year: 2026 + (age - 29),
  bars: rungs.map((r, i) => ({
    label: r.label,
    isCurrent: r.isCurrent,
    value: { today: values[i], nominal: values[i] * 2 },
  })),
});

const base: EarlyYearsLadderPageData = {
  subtitle: "Base Case · Today's dollars first · Future-year dollars beneath",
  groups: [
    group(40, [220_000, 265_000, 310_000]),
    group(50, [470_000, 590_000, 715_000]),
    group(65, [1_035_097, 1_345_626, 1_656_156]),
  ],
  rungs,
  cappedRungLabels: [],
  emptyMessage: null,
  takeaway:
    "At age 65, the Save 14% bar is about $621K today ($1.2M in 2062 dollars) ahead of Save 8% (today).",
  tidbits: [
    {
      id: "compounding-runway",
      title: "Time is the ingredient you can't buy later",
      body: "A dollar saved in your twenties has decades to double and double again.",
      topic: "compounding",
    },
  ],
  basis: { inflationRate: 0.03, planStartYear: 2026 },
};

function render(data: EarlyYearsLadderPageData) {
  ensureFontsRegistered();
  return renderToBuffer(
    <Document>
      {EarlyYearsLadderPagePdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "Cooper Sample",
        reportDate: "June 10, 2026",
        pageIndex: 2,
        totalPages: 2,
        accent: SECTION_ACCENTS["Early Years"],
      })}
    </Document>,
  );
}

/**
 * The text the sheet actually prints, via `pdftotext`. Byte length cannot see a
 * footnote — R8 — so the page's own claims are read back off the rendered
 * bytes. Requires poppler on PATH (`brew install poppler`) and says so rather
 * than skipping itself.
 */
function pdfText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "early-years-ladder-"));
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

describe("EarlyYearsLadderPagePdf render", () => {
  it("renders to a non-trivial PDF buffer", async () => {
    expect((await render(base)).byteLength).toBeGreaterThan(1000);
  });

  it("prints the rung legend, the milestone ages, a bar figure and the takeaway", async () => {
    const text = pdfText(await render(base)).replace(/\s+/g, " ");
    expect(text).toContain("Save 8% (today)");
    expect(text).toContain("Save 14%");
    expect(text).toContain("Age 65");
    expect(text).toContain("$1.7M");
    expect(text).toContain("the Save 14% bar is about $621K today");
    expect(text).toContain("$3,312,312 in 2062");
    expect(text).toContain("both units below");
    expect(text).toContain("Time is the ingredient you can't buy later");
  });

  // R8 — the footnote is the whole reason the cap is detected. A byte-length
  // assertion could never see whether it printed.
  it("prints the IRS-limit footnote only when a rung was capped", async () => {
    const withCap = pdfText(await render({ ...base, cappedRungLabels: ["Save 14%"] }))
      .replace(/\s+/g, " ");
    expect(withCap).toContain(
      "At Save 14%, contributions reach the IRS annual limit — those bars show the capped amount.",
    );
    expect(pdfText(await render(base))).not.toContain("IRS annual limit");
  });

  it("names every capped rung, not just the first", async () => {
    const text = pdfText(await render({ ...base, cappedRungLabels: ["Save 11%", "Save 14%"] }))
      .replace(/\s+/g, " ");
    expect(text).toContain("At Save 11% and Save 14%, contributions reach the IRS annual limit");
  });

  it("renders the empty state instead of a chart when nothing could be modelled", async () => {
    const text = pdfText(
      await render({
        ...base,
        groups: [],
        takeaway: null,
        tidbits: [],
        emptyMessage:
          "This plan has no payroll retirement contributions to model, so there is no contribution to raise.",
      }),
    ).replace(/\s+/g, " ");
    expect(text).toContain("no payroll retirement contributions to model");
    // The empty state must not still print the ladder it cannot stand behind.
    expect(text).not.toContain("Save 14%");
    expect(text).not.toContain("Age 65");
  });

  // F1 — the sheet used to print "no payroll retirement contributions" for
  // every reason it had no chart, including a client who contributes the
  // annual maximum and whose dollars the previous sheet has just reported.
  it("prints the reason it was given, not one hard-coded sentence", async () => {
    const text = pdfText(
      await render({
        ...base,
        groups: [],
        takeaway: null,
        tidbits: [],
        emptyMessage:
          "This plan's retirement contributions are already set to the annual IRS maximum, so there is no rate left to raise.",
      }),
    ).replace(/\s+/g, " ");
    expect(text).toContain("already set to the annual IRS maximum");
    expect(text).not.toContain("no payroll retirement contributions");
  });
});
