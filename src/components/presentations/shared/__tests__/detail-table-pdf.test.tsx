import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, Page, renderToBuffer, Text } from "@react-pdf/renderer";
import { DetailTablePdf } from "../detail-table-pdf";
import { DualDollarValuePdf } from "../dual-dollar-value-pdf";
import { ensureFontsRegistered } from "../fonts";

async function textOf(): Promise<string> {
  ensureFontsRegistered();
  const pdf = await renderToBuffer(
    <Document>
      <Page size="LETTER">
        <DetailTablePdf
          rows={[
            { year: 2025, today: 0, nominal: 0 },
            { year: 2026, today: 120_000, nominal: 120_000 },
            { year: 2055, today: 800_000, nominal: 1_600_000 },
            { year: 2060, today: 1_125_232, nominal: 2_520_232 },
          ]}
          rowKey={(row) => String(row.year)}
          columns={[
            { header: "Year", flex: 1, render: (row) => <Text>{row.year}</Text> },
            {
              header: "Portfolio",
              flex: 2,
              align: "right",
              render: (row) => (
                <DualDollarValuePdf value={{ today: row.today, nominal: row.nominal }} />
              ),
            },
          ]}
        />
      </Page>
    </Document>,
  );
  const dir = mkdtempSync(join(tmpdir(), "detail-table-"));
  try {
    const file = join(dir, "table.pdf");
    const text = join(dir, "table.txt");
    writeFileSync(file, pdf);
    execFileSync("pdftotext", ["-layout", file, text]);
    return readFileSync(text, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("DetailTablePdf", () => {
  it("prints today's dollars first and plain-language future-year dollars beneath it", async () => {
    const text = await textOf();
    expect(text).toContain("$1,125,232 today");
    expect(text).toContain("$2,520,232 future-year dollars");
  });

  it("does not repeat a current-year amount when both units are identical", async () => {
    const text = await textOf();
    expect(text).toContain("$120,000 today");
    expect(text).toContain("Same amount in future-year dollars");
    expect(text).not.toContain("Same in 2026");
    expect(text).not.toContain("$120,000 future-year dollars");
  });

  it("does not add a redundant future-year line to zero", async () => {
    const text = await textOf();
    expect(text).toContain("$0 today");
    expect(text.match(/Same amount in future-year dollars/g)).toHaveLength(1);
  });

  it("prints the final row instead of clipping a wrapped flex row", async () => {
    expect(await textOf()).toContain("2060");
  });
});
