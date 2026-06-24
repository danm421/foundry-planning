// src/lib/portal/dashboard-summary.ts
//
// Pure derivations for the portal Dashboard tiles. NO DB/Next imports — unit-
// testable in plain vitest (mirrors budget-summary.ts).
import type { GroupCell } from "@/lib/portal/budget-summary";
import type { RecurringRowDTO } from "@/lib/portal/load-recurrings-data";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function daysInMonth(now: Date): number {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

// ---- Monthly spending pace curve -------------------------------------------
export interface PacePoint {
  day: number;
  cumulative: number;
  pace: number;
}

/**
 * Cumulative expense spend by day-of-month (days 1..today) vs a linear budget
 * pace line (pace at day d = totalBudget * d / N). `dailySpend` amounts are
 * signed Plaid sums (positive = money out); refunds net the cumulative down.
 * `underBy` > 0 means under pace at today.
 */
export function spendingPaceCurve(input: {
  dailySpend: { date: string; amount: number }[];
  totalBudget: number;
  now: Date;
}): { points: PacePoint[]; spentToDate: number; underBy: number } {
  const { dailySpend, totalBudget, now } = input;
  const n = daysInMonth(now);
  const today = Math.min(now.getUTCDate(), n);
  const byDay = new Array<number>(n + 1).fill(0);
  for (const t of dailySpend) {
    const d = Number(t.date.slice(8, 10));
    if (d >= 1 && d <= n) byDay[d] += t.amount;
  }
  const points: PacePoint[] = [];
  let cum = 0;
  for (let d = 1; d <= today; d++) {
    cum += byDay[d];
    points.push({ day: d, cumulative: round2(cum), pace: round2((totalBudget * d) / n) });
  }
  const spentToDate = round2(cum);
  const paceToday = round2((totalBudget * today) / n);
  return { points, spentToDate, underBy: round2(paceToday - spentToDate) };
}

// ---- Net this month --------------------------------------------------------
export function netThisMonth(input: {
  income: number;
  spent: number;
  priorIncome: number;
  priorSpent: number;
}): { net: number; prior: number; deltaAbs: number; deltaPct: number | null } {
  const net = round2(input.income - input.spent);
  const prior = round2(input.priorIncome - input.priorSpent);
  const deltaAbs = round2(net - prior);
  const deltaPct = prior === 0 ? null : round2((deltaAbs / Math.abs(prior)) * 100);
  return { net, prior, deltaAbs, deltaPct };
}

// ---- Recurrings due within N days ------------------------------------------
export interface DueRecurring {
  id: string;
  name: string;
  cadence: "monthly" | "annually";
  predicted: number;
  state: "paid" | "due" | "overdue";
  dueDate: string;
  daysUntil: number;
  postedThisMonth: number;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function dayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/** The relevant due date: overdue → this period's dueDay (passed); else the next occurrence. */
function dueDateFor(r: RecurringRowDTO, now: Date): Date | null {
  if (r.dueDay == null) return null;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (r.cadence === "annually") {
    if (r.dueMonth == null) return null;
    const thisYear = new Date(Date.UTC(y, r.dueMonth - 1, r.dueDay));
    if (r.state === "overdue") return thisYear;
    return dayDiff(now, thisYear) >= 0
      ? thisYear
      : new Date(Date.UTC(y + 1, r.dueMonth - 1, r.dueDay));
  }
  const thisMonth = new Date(Date.UTC(y, m, r.dueDay));
  if (r.state === "overdue") return thisMonth;
  return dayDiff(now, thisMonth) >= 0 ? thisMonth : new Date(Date.UTC(y, m + 1, r.dueDay));
}

/**
 * From the recurrings list, those due within `days` of `now`, plus anything
 * overdue (which carries a negative `daysUntil`). Items without a dueDay are
 * skipped (can't be placed on a calendar). Sorted by due date ascending.
 */
export function dueWithinDays(
  recurrings: RecurringRowDTO[],
  now: Date,
  days = 14,
): DueRecurring[] {
  const out: DueRecurring[] = [];
  for (const r of recurrings) {
    const due = dueDateFor(r, now);
    if (!due) continue;
    const daysUntil = dayDiff(now, due);
    if (r.state === "overdue" || (daysUntil >= 0 && daysUntil <= days)) {
      out.push({
        id: r.id,
        name: r.name,
        cadence: r.cadence,
        predicted: r.predicted,
        state: r.state,
        dueDate: ymd(due),
        daysUntil,
        postedThisMonth: r.postedThisMonth,
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// ---- Top categories --------------------------------------------------------
export interface TopCategory {
  id: string;
  name: string;
  color: string;
  spent: number;
  budget: number | null;
}

export function topCategories(groups: GroupCell[], n: number): TopCategory[] {
  return groups
    .filter((g) => g.actual > 0)
    .sort((a, b) => b.actual - a.actual)
    .slice(0, n)
    .map((g) => ({ id: g.id, name: g.name, color: g.color, spent: g.actual, budget: g.budget }));
}
