import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { extractExcelText } from "../excel-parser";

async function buildXlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRows(rows);
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

describe("extractExcelText", () => {
  it("extracts text from a simple workbook", async () => {
    const buffer = await buildXlsxBuffer([
      ["Account", "Value"],
      ["Checking", 50000],
      ["IRA", 200000],
    ]);

    const text = await extractExcelText(buffer);
    expect(text).toContain("Checking");
    expect(text).toContain("50000");
    expect(text).toContain("IRA");
    expect(text).toContain("200000");
  });

  it("returns empty string for empty buffer", async () => {
    expect(await extractExcelText(Buffer.from(""))).toBe("");
  });
});
