export type TxnType = "income" | "expense" | "transfer";

// Sign + color follow CASH DIRECTION (Plaid amount sign), independent of type:
// money in (amount < 0) → +$ green; money out (amount > 0) → -$ neutral.
export function fmtAmount(amount: string): { text: string; cls: string } {
  const n = Number(amount);
  const abs = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (n < 0) return { text: `+${abs}`, cls: "text-good" };
  if (n > 0) return { text: `-${abs}`, cls: "text-ink" };
  return { text: abs, cls: "text-ink" };
}

// "2026-05-30" → "SAT, MAY 30". Parse as UTC to avoid local-timezone drift.
export function formatDayHeader(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

// Leading badge letter: type wins (T/I), else recurring (R), else none.
export function badgeFor(type: TxnType, isRecurring: boolean): "T" | "I" | "R" | null {
  if (type === "transfer") return "T";
  if (type === "income") return "I";
  if (isRecurring) return "R";
  return null;
}
