// RFC-4180 CSV serialization. Uses CRLF line endings per the spec so files
// open cleanly in Excel on Windows; modern macOS Excel handles both.
//
// A cell starting with = + - @ tab or CR is read as a formula by spreadsheet
// apps, and account names come from clients. Such cells get a leading ' so they
// open as text — except plain signed numbers and percentages like -3.25%.
const FORMULA_START = /^[=+\-@\t\r]/;
const SIGNED_NUMBER = /^[+-]\d+(\.\d+)?%?$/;

function escapeField(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (FORMULA_START.test(s) && !SIGNED_NUMBER.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function serializeCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  if (rows.length === 0) return "";
  return rows.map((r) => r.map(escapeField).join(",")).join("\r\n") + "\r\n";
}
