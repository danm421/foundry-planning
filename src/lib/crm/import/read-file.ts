import ExcelJS from "exceljs";

/** xlsx files are zip containers — sniff the PK signature. */
function isXlsx(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Minimal RFC-4180 CSV tokenizer: quoted fields (commas/newlines inside),
 * `""` escapes, CRLF and bare-CR line endings. Every cell stays a string —
 * no number/date coercion, so `02110` keeps its leading zero and DOB
 * columns stay the literal `YYYY-MM-DD` the advisor typed.
 */
function parseCsvRows(text: string): (string | number)[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Flatten an exceljs cell value to the string/number shape the row loop
 * expects. Numbers stay numbers (the postal-code pad below needs to see
 * them); true date cells become the ISO `YYYY-MM-DD` string the advisor
 * intended (exceljs parses Excel date serials as UTC); rich text /
 * hyperlinks / formulas collapse to their text or result.
 */
function normalizeXlsxCell(v: ExcelJS.CellValue): string | number {
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text ?? "");
    if ("result" in v) return normalizeXlsxCell(v.result as ExcelJS.CellValue);
    if ("error" in v) return "";
  }
  return String(v);
}

async function readXlsxRows(buffer: Buffer): Promise<(string | number)[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs types load() against an older Buffer interface; hand it the
  // runtime-compatible ArrayBuffer view it actually accepts (same cast as
  // src/lib/extraction/excel-parser.ts).
  await wb.xlsx.load(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
  );
  const sheet = wb.worksheets[0];
  if (!sheet) {
    throw new Error("Empty workbook");
  }
  const rows: (string | number)[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    // row.values is 1-based; index 0 is always empty.
    const values = row.values as ExcelJS.CellValue[];
    const cells: (string | number)[] = [];
    for (let i = 1; i < values.length; i++) {
      cells.push(normalizeXlsxCell(values[i]));
    }
    rows.push(cells);
  });
  return rows;
}

/**
 * Read a CSV or single-sheet xlsx buffer into a raw grid. Row 0 is the header.
 *
 * NOT client-safe (exceljs). Cells keep their type: numbers stay numbers so an
 * Excel date serial reaches parseImportDate intact, and postal codes that
 * arrive as numbers can be zero-padded downstream.
 */
export async function readGrid(buffer: Buffer): Promise<(string | number)[][]> {
  if (isXlsx(buffer)) return readXlsxRows(buffer);
  return parseCsvRows(buffer.toString("utf8"));
}
