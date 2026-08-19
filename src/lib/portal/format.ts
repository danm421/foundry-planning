// Pinned to en-US and hoisted — a drawer of holdings formats every row's
// shares, price, basis and value, and building an Intl.NumberFormat per cell is
// the expensive part. Same reason the holdings deck hoists its own (see
// presentations/pages/holdings/view-model.ts).
const USD0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const USD2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const SHARES = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

/** "2026-06-12" → "Jun 12" (UTC-pinned so the day never shifts across timezones). */
export function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function fmtUsd(n: number): string {
  return USD0.format(n);
}

/**
 * A share price, to the cent. Rounding a price to whole dollars misreads a
 * position — a bond quoted at 99.5 is not "$100" — so prices keep two decimals
 * here, matching the advisor's holdings table and the holdings PDF.
 */
export function fmtUsdCents(n: number): string {
  return USD2.format(n);
}

/**
 * Share counts. Four decimals is the app's convention for a position (see the
 * holdings presentation page) — fractional shares are real, and whole ones
 * must not grow a trailing ".0000".
 */
export function fmtShares(n: number): string {
  return SHARES.format(n);
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
