// Pure recurring-transaction matching / prediction / period logic.
// NO @/db, Next, or Plaid imports — unit-tested in plain vitest.
import type { RecurringRowDTO, RecurringsDTO } from "@/lib/portal/contracts";
export type { RecurringRowDTO };
export type RecurringsData = RecurringsDTO;

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

export function round2(n: number): number {
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

export function isRecurringDueInMonth(
  r: { cadence: "monthly" | "annually"; dueMonth: number | null },
  month: string,
): boolean {
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}
function isoDate(year: number, month1: number, day: number): string {
  return `${year}-${pad2(month1)}-${pad2(Math.min(day, lastDayOfMonth(year, month1)))}`;
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
function fmtWhole(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function nextPaymentDate(
  r: { cadence: "monthly" | "annually"; dueDay: number | null; dueMonth: number | null },
  today: string,
  paidThisPeriod: boolean,
): string | null {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)); // 1-12
  const d = Number(today.slice(8, 10));
  if (r.cadence === "monthly") {
    const day = r.dueDay ?? 1;
    let year = y;
    let month = m;
    if (d > day || paidThisPeriod) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return isoDate(year, month, day);
  }
  if (r.dueMonth == null) return null;
  const day = r.dueDay ?? 1;
  let year = y;
  const passed = m > r.dueMonth || (m === r.dueMonth && d > day);
  if (passed || paidThisPeriod) year += 1;
  return isoDate(year, r.dueMonth, day);
}

export function buildTimeline(
  matchedDates: string[],
  now: Date,
  months = 12,
): { month: string; paid: boolean }[] {
  const paidMonths = new Set(matchedDates.map((d) => d.slice(0, 7)));
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-11
  const out: { month: string; paid: boolean }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - i, 1));
    const key = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
    out.push({ month: key, paid: paidMonths.has(key) });
  }
  return out;
}

export function computeYearlyMetrics(
  matched: { date: string; amount: number }[],
): { year: number; total: number; avg: number; count: number }[] {
  const byYear = new Map<number, { total: number; count: number }>();
  for (const t of matched) {
    const year = Number(t.date.slice(0, 4));
    const cur = byYear.get(year) ?? { total: 0, count: 0 };
    cur.total += t.amount;
    cur.count += 1;
    byYear.set(year, cur);
  }
  return [...byYear.entries()]
    .map(([year, { total, count }]) => ({
      year, total: round2(total), count, avg: round2(total / count),
    }))
    .sort((a, b) => b.year - a.year);
}

type AssembleInput = {
  rows: {
    id: string; name: string; matchType: "exact" | "contains"; pattern: string;
    amountMin: number; amountMax: number; cadence: "monthly" | "annually";
    dueDay: number | null; dueMonth: number | null; categoryId: string;
  }[];
  claimedThisMonth: { recurringTransactionId: string | null; amount: number }[];
  history: { recurringTransactionId: string | null; amount: number; date: string }[];
  categories: { id: string; name: string; color: string | null; icon: string | null }[];
  month: string; // YYYY-MM
  today: string; // YYYY-MM-DD
  now: Date;
};

export function assembleRecurringView(input: AssembleInput): RecurringsData {
  const { rows, claimedThisMonth, history, categories, month, today, now } = input;
  const catById = new Map(categories.map((c) => [c.id, c]));

  const postedByRecurring = new Map<string, number>();
  for (const c of claimedThisMonth) {
    if (!c.recurringTransactionId) continue;
    postedByRecurring.set(
      c.recurringTransactionId,
      (postedByRecurring.get(c.recurringTransactionId) ?? 0) + c.amount,
    );
  }

  const historyByRecurring = new Map<string, { date: string; amount: number }[]>();
  for (const h of history) {
    if (!h.recurringTransactionId) continue;
    const list = historyByRecurring.get(h.recurringTransactionId) ?? [];
    list.push({ date: h.date, amount: h.amount });
    historyByRecurring.set(h.recurringTransactionId, list);
  }

  let paidSoFar = 0;
  let leftToPay = 0;
  const recurrings: RecurringRowDTO[] = [];

  for (const r of rows) {
    const dueThisMonth = isRecurringDueInMonth(r, month);
    const postedThisMonth = postedByRecurring.get(r.id) ?? 0;
    const matched = historyByRecurring.get(r.id) ?? [];
    const predicted = predictRecurringAmount(matched.map((m) => m.amount), {
      amountMin: r.amountMin, amountMax: r.amountMax,
    });
    const state = recurringPeriodState({
      dueDay: r.dueDay, today, hasMatchThisPeriod: postedThisMonth > 0,
    });
    const cat = catById.get(r.categoryId);
    recurrings.push({
      id: r.id, name: r.name, cadence: r.cadence, dueDay: r.dueDay, dueMonth: r.dueMonth,
      matchType: r.matchType, pattern: r.pattern, amountMin: r.amountMin, amountMax: r.amountMax,
      categoryId: r.categoryId,
      categoryName: cat?.name ?? null, categoryColor: cat?.color ?? null, categoryIcon: cat?.icon ?? null,
      predicted, state, postedThisMonth,
      nextPaymentDate: nextPaymentDate(r, today, postedThisMonth > 0),
      timeline: buildTimeline(matched.map((m) => m.date), now),
      metricsByYear: computeYearlyMetrics(matched),
    });
    if (dueThisMonth) {
      if (postedThisMonth > 0) paidSoFar += postedThisMonth;
      else leftToPay += predicted;
    }
  }

  return { recurrings, paidSoFar: round2(paidSoFar), leftToPay: round2(leftToPay), month };
}

export function describeRules(r: {
  matchType: "exact" | "contains";
  pattern: string;
  amountMin: number;
  amountMax: number;
  cadence: "monthly" | "annually";
  dueDay: number | null;
  dueMonth: number | null;
}): string[] {
  const chips: string[] = [];
  chips.push(r.matchType === "exact" ? `Named exactly ${r.pattern}` : `Named ${r.pattern}`);
  chips.push(`from ${fmtWhole(r.amountMin)} to ${fmtWhole(r.amountMax)}`);
  if (r.cadence === "monthly") {
    chips.push(r.dueDay == null ? "anytime in the month" : `around the ${ordinal(r.dueDay)}`);
    chips.push("every month");
  } else {
    if (r.dueMonth != null) chips.push(`in ${MONTH_NAMES[r.dueMonth - 1]}`);
    chips.push("every year");
  }
  return chips;
}
