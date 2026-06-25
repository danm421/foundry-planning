export function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Comma-group a raw numeric *string* for display in an editable amount field
 * ("2700" → "2,700"). Empty or non-numeric input is returned untouched so a
 * half-typed value ("2700.") survives. The caller keeps the raw string as state
 * — this is display-only, so `Number(raw)` parsing stays valid.
 */
export function groupNumber(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const n = Number(trimmed);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : raw;
}
