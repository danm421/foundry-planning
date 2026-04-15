import * as XLSX from "xlsx";

/**
 * Extract text from an Excel/CSV buffer as tab-separated rows.
 */
export function extractExcelText(buffer: Buffer): string {
  if (buffer.length === 0) return "";

  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      if (workbook.SheetNames.length > 1) {
        parts.push(`--- Sheet: ${sheetName} ---`);
      }

      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
      parts.push(csv);
    }

    return parts.join("\n");
  } catch {
    return "";
  }
}
