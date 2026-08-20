import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { EarlyYearsWaitingPagePdf } from "./page-pdf";
import type { EarlyYearsWaitingPageData } from "@/lib/presentations/pages/early-years-waiting/types";

const base: EarlyYearsWaitingPageData = {
  subtitle: "Base Case · Every figure in today's dollars",
  groups: [
    { age: 40, bars: [{ value: 260_000 }, { value: 235_000 }, { value: 215_000 }] },
    { age: 50, bars: [{ value: 590_000 }, { value: 540_000 }, { value: 495_000 }] },
    { age: 65, bars: [{ value: 1_340_000 }, { value: 1_205_000 }, { value: 1_090_000 }] },
  ],
  seriesLabels: ["Start now", "Start in 5 years", "Start in 10 years"],
  raisedRate: 0.11,
  takeaway: "Waiting five years costs about $135K by age 65.",
  isCapped: false,
  emptyMessage: null,
  tidbits: [],
  basis: { inflationRate: 0.03, planStartYear: 2026 },
};

async function textOf(data: EarlyYearsWaitingPageData): Promise<string> {
  ensureFontsRegistered();
  const buf = await renderToBuffer(
    <Document>
      {EarlyYearsWaitingPagePdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "Cooper Sample",
        reportDate: "August 20, 2026",
        pageIndex: 5,
        totalPages: 8,
        accent: SECTION_ACCENTS["Early Years"],
      })}
    </Document>,
  );
  const dir = mkdtempSync(join(tmpdir(), "waiting-"));
  try {
    const pdf = join(dir, "p.pdf");
    writeFileSync(pdf, buf);
    execFileSync("pdftotext", ["-layout", pdf, join(dir, "p.txt")]);
    return readFileSync(join(dir, "p.txt"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("EarlyYearsWaitingPagePdf", () => {
  it("prints one legend entry per start date, the age clusters and the bar values", async () => {
    const text = await textOf(base);
    expect(text).toContain("Start now");
    expect(text).toContain("Start in 10 years");
    expect(text).toContain("Age 65");
    // Chart-only: the takeaway quotes $135K, not this.
    expect(text).toContain("$1.3M");
  });

  it("says on the sheet that only the start date changes, and names the rate once", async () => {
    const text = await textOf(base);
    expect(text).toContain("only the start date changes");
    expect(text).toContain("11%");
  });

  it("names the IRS limit only when it bound", async () => {
    expect(await textOf(base)).not.toContain("IRS annual limit");
    expect(await textOf({ ...base, isCapped: true })).toContain("IRS annual limit");
  });

  it("prints the empty state instead of three identical bars", async () => {
    const text = await textOf({
      ...base,
      groups: [],
      emptyMessage:
        "This plan has no payroll retirement contributions to model, so there is no contribution to start sooner.",
    });
    expect(text).toContain("no payroll retirement contributions");
    expect(text).not.toContain("Age 65");
  });
});
