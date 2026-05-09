// RFC-4180 CSV serialization. Uses CRLF line endings per the spec so files
// open cleanly in Excel on Windows; modern macOS Excel handles both.
function escapeField(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function serializeCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  if (rows.length === 0) return "";
  return rows.map((r) => r.map(escapeField).join(",")).join("\r\n") + "\r\n";
}
