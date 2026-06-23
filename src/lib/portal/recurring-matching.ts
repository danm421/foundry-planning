// Pure recurring-transaction matching / prediction / period logic.
// NO @/db, Next, or Plaid imports — unit-tested in plain vitest.

export type RecurringLike = {
  id: string;
  matchType: "exact" | "contains";
  pattern: string;
  amountMin: number;
  amountMax: number;
  cadence: "monthly" | "annually";
  dueDay: number | null;
  dueMonth: number | null; // 1-12 for annual; null for monthly
  categoryId: string;
  createdAt: Date;
};

export type TxnMatchInput = {
  merchantName: string | null;
  name: string;
  amount: number; // spend-positive
  date: string; // YYYY-MM-DD
};

function patternMatches(r: RecurringLike, txn: TxnMatchInput): boolean {
  const pat = r.pattern.trim().toLowerCase();
  if (!pat) return false;
  for (const f of [txn.merchantName, txn.name]) {
    if (f == null) continue;
    const v = f.toLowerCase();
    if (r.matchType === "exact" ? v === pat : v.includes(pat)) return true;
  }
  return false;
}

export function matchesRecurring(r: RecurringLike, txn: TxnMatchInput): boolean {
  if (!patternMatches(r, txn)) return false;
  if (txn.amount < r.amountMin || txn.amount > r.amountMax) return false;
  // Period: monthly matches any month; annual matches any month too (period is
  // the year). Budget reservation is gated to the due month by
  // isRecurringDueInMonth, not here.
  return true;
}

export function resolveRecurringClaim(
  recurrings: RecurringLike[],
  txn: TxnMatchInput,
): { recurringId: string; categoryId: string } | null {
  const sorted = [...recurrings].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  for (const r of sorted) {
    if (matchesRecurring(r, txn)) return { recurringId: r.id, categoryId: r.categoryId };
  }
  return null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function predictRecurringAmount(
  matchedAmounts: number[],
  range: { amountMin: number; amountMax: number },
): number {
  if (matchedAmounts.length > 0) {
    const sum = matchedAmounts.reduce((s, a) => s + a, 0);
    return round2(sum / matchedAmounts.length);
  }
  return round2((range.amountMin + range.amountMax) / 2);
}

export function isRecurringDueInMonth(r: RecurringLike, month: string): boolean {
  if (r.cadence === "monthly") return true;
  // annually: due only in dueMonth (month param is YYYY-MM)
  if (r.dueMonth == null) return false;
  const mm = Number(month.slice(5, 7));
  return mm === r.dueMonth;
}

export function recurringPeriodState(args: {
  dueDay: number | null;
  today: string; // YYYY-MM-DD
  hasMatchThisPeriod: boolean;
}): "paid" | "due" | "overdue" {
  if (args.hasMatchThisPeriod) return "paid";
  if (args.dueDay == null) return "due"; // "anytime" never goes overdue mid-month
  const dayOfMonth = Number(args.today.slice(8, 10));
  return dayOfMonth > args.dueDay ? "overdue" : "due";
}
