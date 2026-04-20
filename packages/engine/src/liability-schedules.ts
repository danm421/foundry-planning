import type { Liability } from "./types";
import {
  calcOriginalBalance,
  computeAmortizationSchedule,
  type AmortizationScheduleRow,
  type ScheduleExtraPayment,
} from "./lib/loan-math";

export type LiabilityScheduleMap = Map<string, AmortizationScheduleRow[]>;

/**
 * Monthly amortization schedule for a liability, starting at its origination
 * year. Back-calculates the original balance from the stored balance plus
 * balanceAsOf metadata so the schedule is authoritative for every year from
 * loan start through payoff — matching the balance sheet and amortization tab.
 */
export function buildLiabilitySchedule(
  liability: Liability,
): AmortizationScheduleRow[] {
  const asOfMonth = liability.balanceAsOfMonth ?? liability.startMonth;
  const asOfYear = liability.balanceAsOfYear ?? liability.startYear;
  const elapsedMonths = Math.max(
    0,
    (asOfYear - liability.startYear) * 12 + (asOfMonth - liability.startMonth),
  );
  const originalBalance = calcOriginalBalance(
    liability.balance,
    liability.interestRate,
    liability.monthlyPayment,
    elapsedMonths,
  );
  const extras: ScheduleExtraPayment[] = (liability.extraPayments ?? []).map(
    (ep) => ({ year: ep.year, type: ep.type, amount: ep.amount }),
  );
  return computeAmortizationSchedule(
    originalBalance,
    liability.interestRate,
    liability.monthlyPayment,
    liability.startYear,
    liability.termMonths,
    extras,
  );
}

export function buildLiabilitySchedules(
  liabilities: Liability[],
): LiabilityScheduleMap {
  const map: LiabilityScheduleMap = new Map();
  for (const liab of liabilities) map.set(liab.id, buildLiabilitySchedule(liab));
  return map;
}

export function scheduleRowAt(
  schedule: AmortizationScheduleRow[],
  year: number,
): AmortizationScheduleRow | null {
  return schedule.find((r) => r.year === year) ?? null;
}

/** BoY balance at `year`. Zero after payoff; origBal before origination. */
export function scheduleBoYBalance(
  schedule: AmortizationScheduleRow[],
  year: number,
): number {
  const row = schedule.find((r) => r.year === year);
  if (row) return row.beginningBalance;
  const last = schedule[schedule.length - 1];
  if (last && year > last.year) return 0;
  return schedule[0]?.beginningBalance ?? 0;
}
