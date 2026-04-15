import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { extractExcelText } from "../excel-parser";

describe("extractExcelText", () => {
  it("extracts text from a simple workbook", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Account", "Value"],
      ["Checking", 50000],
      ["IRA", 200000],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

    const text = extractExcelText(buffer);
    expect(text).toContain("Checking");
    expect(text).toContain("50000");
    expect(text).toContain("IRA");
    expect(text).toContain("200000");
  });

  it("returns empty string for empty buffer", () => {
    expect(extractExcelText(Buffer.from(""))).toBe("");
  });
});
