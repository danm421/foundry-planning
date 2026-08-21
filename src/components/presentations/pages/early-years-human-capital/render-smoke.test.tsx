import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { EarlyYearsHumanCapitalPagePdf } from "./page-pdf";
import type { EarlyYearsHumanCapitalPageData } from "@/lib/presentations/pages/early-years-human-capital/types";

const base: EarlyYearsHumanCapitalPageData = {
  subtitle: "Base Case · Today's dollars first · Future-year dollars beneath",
  isEmpty: false,
  invested: { today: 48_000, nominal: 48_000 },
  lifetimeEarnings: { today: 3_120_000, nominal: 5_040_000 },
  multiple: 65,
  lastEarningYear: 2062,
  takeaway:
    "About $3.1M today ($5.0M future-year dollars) of future pay will pass through your hands. That is roughly 65 times what you have invested today, which is why the decisions on the next few pages matter more than the balance on this one.",
  detailRows: [
    { year: 2026, age: 29, salary: { today: 120_000, nominal: 120_000 } },
    { year: 2056, age: 59, salary: { today: 120_000, nominal: 291_272 } },
    { year: 2062, age: 65, salary: { today: 120_000, nominal: 347_739 } },
  ],
  tidbits: [],
};

async function textOf(data: EarlyYearsHumanCapitalPageData): Promise<string> {
  ensureFontsRegistered();
  const buf = await renderToBuffer(
    <Document>
      {EarlyYearsHumanCapitalPagePdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "Cooper Sample",
        reportDate: "August 20, 2026",
        pageIndex: 3,
        totalPages: 8,
        accent: SECTION_ACCENTS["Early Years"],
      })}
    </Document>,
  );
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  try {
    const pdf = join(dir, "p.pdf");
    writeFileSync(pdf, buf);
    execFileSync("pdftotext", ["-layout", pdf, join(dir, "p.txt")]);
    return readFileSync(join(dir, "p.txt"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("EarlyYearsHumanCapitalPagePdf", () => {
  it("prints both bar labels, both figures and the takeaway", async () => {
    const text = await textOf(base);
    expect(text).toContain("Invested today");
    expect(text).toContain("Future pay, through 2062");
    expect(text).toContain("$48K");
    expect(text).toContain("$3.1M");
    expect(text).toContain("$5.0M future-year dollars");
    expect(text).toContain("$347,739 future-year dollars");
    expect(text).toContain("65 times");
  });

  it("says the discount rate on the sheet, per the spec", async () => {
    expect(await textOf(base)).toContain("inflation assumption");
  });

  it("prints the empty state instead of one bar", async () => {
    const text = await textOf({ ...base, isEmpty: true });
    expect(text).toContain("no salary income");
    expect(text).not.toContain("Invested today");
  });

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
    expect(text).toContain("$3.1M");
    // pdftotext emits a form feed per page; the sidebar must not push a second.
    expect(text.split("\f").filter((p) => p.trim().length > 0)).toHaveLength(1);
  });
});
