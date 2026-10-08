import ExcelJS from "exceljs";
import JSZip from "jszip";

/** Excel's last row. A row or cell numbered past it can't come from a real workbook. */
const MAX_ROW = 1_048_576;
/** Unpacked size across every part of the file. A 100k-row, 10-column sheet unpacks to ~40 MB. */
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;
/** Longest single tag the scan will hold across chunks; real worksheet tags are a few hundred bytes. */
const MAX_TAG_BYTES = 1024 * 1024;
/**
 * ExcelJS fills every cell of a merged area on load, and checks each new merge
 * against every earlier one. Past these, the file's merges are skipped rather
 * than the file refused; real sheets merge a few headers or grouping cells.
 */
const MAX_MERGES = 1_000;
const MAX_MERGED_CELLS = 100_000;

/**
 * Worksheet parts our readers never use that ExcelJS expands cell by cell on
 * load — one validation or column range can name billions of cells.
 */
const IGNORED_SHEET_PARTS = ["dataValidations", "cols"];

const WORKSHEET_PART = /^xl\/worksheets\/[^/]+\.xml$/i;
const SCANNED_TAG = /<(row|c|mergeCell)\b[^>]*>/g;
const REF_ATTR = /\sr\s*=\s*["'][^"'\d]*(\d+)["']/;
const MERGE_REF_ATTR = /\sref\s*=\s*["']([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?["']/i;

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

function mergedCells(tag: string): number {
  const m = MERGE_REF_ATTR.exec(tag);
  if (!m) return 0;
  const [, c1, r1, c2 = c1, r2 = r1] = m;
  const rows = Math.abs(Number(r2) - Number(r1)) + 1;
  const cols = Math.abs(columnNumber(c2) - columnNumber(c1)) + 1;
  return rows * cols;
}

export class SpreadsheetLimitError extends Error {
  constructor() {
    super(
      "This spreadsheet is too large to read. Save a copy with just the rows you need and try again.",
    );
    this.name = "SpreadsheetLimitError";
  }
}

/** Unpack one part chunk by chunk; a throw from `onChunk` stops unpacking it. */
function eachChunk(file: JSZip.JSZipObject, onChunk: (chunk: Buffer) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = file.nodeStream("nodebuffer");
    stream.on("data", (chunk: Buffer) => {
      try {
        onChunk(chunk);
      } catch (err) {
        stream.pause();
        stream.removeAllListeners();
        reject(err);
      }
    });
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
}

/**
 * Unpack every part of the xlsx once, before ExcelJS sees it: refuse a file
 * that unpacks past the size cap, or whose worksheets number a row past
 * Excel's last row (ExcelJS sizes its row array from that number). Reports
 * whether the file's merges are small enough to load.
 */
async function scanWorkbook(buffer: Buffer): Promise<{ keepMerges: boolean }> {
  const zip = await JSZip.loadAsync(buffer);
  let unpacked = 0;
  let merges = 0;
  let merged = 0;
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    const scan = WORKSHEET_PART.test(file.name);
    const decoder = new TextDecoder();
    let carry = "";
    await eachChunk(file, (chunk) => {
      unpacked += chunk.length;
      if (unpacked > MAX_UNPACKED_BYTES) throw new SpreadsheetLimitError();
      if (!scan) return;
      const text = carry + decoder.decode(chunk, { stream: true });
      // Hold back a tag cut off at the chunk boundary until it closes.
      const open = text.lastIndexOf("<");
      const complete = open > text.lastIndexOf(">") ? text.slice(0, open) : text;
      carry = text.slice(complete.length);
      if (carry.length > MAX_TAG_BYTES) throw new SpreadsheetLimitError();
      for (const [tag, name] of complete.matchAll(SCANNED_TAG)) {
        if (name === "mergeCell") {
          merges += 1;
          merged += mergedCells(tag);
          continue;
        }
        const row = REF_ATTR.exec(tag)?.[1];
        if (row !== undefined && Number(row) > MAX_ROW) throw new SpreadsheetLimitError();
      }
    });
  }
  return { keepMerges: merges <= MAX_MERGES && merged <= MAX_MERGED_CELLS };
}

/**
 * Load an uploaded xlsx for reading cell values. Throws SpreadsheetLimitError
 * for a file past the limits above, before ExcelJS allocates anything for it.
 *
 * NOT client-safe (exceljs).
 */
export async function loadXlsxWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const { keepMerges } = await scanWorkbook(buffer);
  const workbook = new ExcelJS.Workbook();
  // exceljs types load() against an older Buffer interface; hand it the
  // runtime-compatible ArrayBuffer view it actually accepts.
  await workbook.xlsx.load(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
    // Skipped merges read as Excel shows them: the value once, in the top-left cell.
    { ignoreNodes: keepMerges ? IGNORED_SHEET_PARTS : [...IGNORED_SHEET_PARTS, "mergeCells"] },
  );
  return workbook;
}
