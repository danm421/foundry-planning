import ExcelJS from "exceljs";

/**
 * Extract text from an Excel/CSV buffer as tab-separated rows.
 */
export async function extractExcelText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) return "";

  try {
    const workbook = new ExcelJS.Workbook();
    // ExcelJS types its load() arg as an older Buffer interface; cast to the
     // runtime-compatible ArrayBuffer view it actually accepts.
    await workbook.xlsx.load(buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer);

    const parts: string[] = [];
    const sheetCount = workbook.worksheets.length;

    for (const worksheet of workbook.worksheets) {
      if (sheetCount > 1) {
        parts.push(`--- Sheet: ${worksheet.name} ---`);
      }

      const rows: string[] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const values = row.values as unknown[];
        const cells: string[] = [];
        for (let i = 1; i < values.length; i++) {
          const v = values[i];
          if (v == null) {
            cells.push("");
          } else if (typeof v === "object" && "text" in (v as object)) {
            cells.push(String((v as { text: unknown }).text ?? ""));
          } else if (typeof v === "object" && "result" in (v as object)) {
            cells.push(String((v as { result: unknown }).result ?? ""));
          } else if (v instanceof Date) {
            cells.push(v.toISOString());
          } else {
            cells.push(String(v));
          }
        }
        rows.push(cells.join("\t"));
      });

      parts.push(rows.join("\n"));
    }

    return parts.join("\n");
  } catch {
    return "";
  }
}
