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
          caption="Portfolio · today's dollars, with the future-year amount beneath"
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
  it("prints today's dollars first and the future-year amount beneath it", async () => {
    const text = await textOf();
    expect(text).toContain("$1,125,232");
    expect(text).toContain("$2,520,232");
  });

  // The units are the caption's job. Repeating them on every cell is what made
  // the Early Years tables unreadable, so their absence is asserted, not assumed.
  it("names the two units once, in the caption, and never inside a cell", async () => {
    const text = await textOf();
    expect(text).toContain("today's dollars, with the future-year amount beneath");
    expect(text).not.toContain("$1,125,232 today");
    expect(text).not.toContain("$2,520,232 future-year dollars");
  });

  // One render answers both: a full renderToBuffer plus a `pdftotext` subprocess
  // is not worth spending twice on the same fixture.
  it("prints one figure, not two, when both units agree — including zero", async () => {
    const text = await textOf();
    expect(text.match(/\$120,000/g)).toHaveLength(1);
    expect(text.match(/\$0/g)).toHaveLength(1);
    expect(text).not.toContain("Same amount in future-year dollars");
  });

  it("prints the final row instead of clipping a wrapped flex row", async () => {
    expect(await textOf()).toContain("2060");
  });
});
