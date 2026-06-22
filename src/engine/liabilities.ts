import type { Liability } from "./types";
import { isHeldFlatLiability } from "./liability-kind";
import {
  buildLiabilitySchedule,
  type LiabilityScheduleMap,
} from "./liability-schedules";

export interface AmortizationResult {
  annualPayment: number;
  interestPortion: number;
  principalPortion: number;
  endingBalance: number;
}

interface LiabilitiesResult {
  totalPayment: number;
  updatedLiabilities: Liability[];
  byLiability: Record<string, number>;
  interestByLiability: Record<string, number>;
}

/**
 * One-shot annual amortization for a single liability. Delegates to the
 * monthly amortization schedule from lib/loan-math so the answer matches the
 * balance sheet and amortization tab. Used directly by a few UI pages that
 * don't run a full projection (e.g. the deductions page's current-year
 * interest estimate); the main projection uses the pre-built schedule map.
 */
export function amortizeLiability(
  liability: Liability,
  year: number,
): AmortizationResult {
  // Held-flat debt: revolving (credit card), or any liability with no
  // amortization term (e.g. a Plaid-synced loan). No schedule, no payment, no
  // accrual; the balance carries forward unchanged. Card spending is already
  // modeled as expenses, so amortizing would double-count; a no-term loan has
  // no schedule to amortize and would otherwise be silently zeroed.
  if (isHeldFlatLiability(liability)) {
    return {
      annualPayment: 0,
      interestPortion: 0,
      principalPortion: 0,
      endingBalance: liability.balance,
    };
  }
  const schedule = buildLiabilitySchedule(liability);
  const row = schedule.find((r) => r.year === year);
  if (!row) {
    return {
      annualPayment: 0,
      interestPortion: 0,
      principalPortion: 0,
      endingBalance: 0,
    };
  }
  return {
    annualPayment: row.payment + row.extraPayment,
    interestPortion: row.interest,
    principalPortion: row.principal + row.extraPayment,
    endingBalance: row.endingBalance,
  };
}

export function computeLiabilities(
  liabilities: Liability[],
  year: number,
  filter?: (liab: Liability) => boolean,
  schedules?: LiabilityScheduleMap,
): LiabilitiesResult {
  let totalPayment = 0;
  const updatedLiabilities: Liability[] = [];
  const byLiability: Record<string, number> = {};
  const interestByLiability: Record<string, number> = {};

  for (const liab of liabilities) {
    // Held-flat debt (revolving cards, or any liability with no amortization
    // term — e.g. a Plaid-synced loan): no schedule, no payment, no accrual; the
    // balance carries forward unchanged. Must NOT fall through to
    // buildLiabilitySchedule (the `??` below would build an empty schedule and
    // silently zero the balance).
    if (isHeldFlatLiability(liab)) {
      updatedLiabilities.push({ ...liab });
      byLiability[liab.id] = 0;
      interestByLiability[liab.id] = 0;
      continue; // excluded from totalPayment (no outflow)
    }

    const schedule = schedules?.get(liab.id) ?? buildLiabilitySchedule(liab);
    const row = schedule.find((r) => r.year === year);
    const annualPayment = row ? row.payment + row.extraPayment : 0;
    const interestPortion = row ? row.interest : 0;
    // After payoff the schedule ends; preserve a zero balance and keep the
    // roll-forward consistent across years.
    const endingBalance = row ? row.endingBalance : 0;

    updatedLiabilities.push({ ...liab, balance: endingBalance });
    byLiability[liab.id] = annualPayment;
    interestByLiability[liab.id] = interestPortion;
    if (filter && !filter(liab)) continue;
    totalPayment += annualPayment;
  }

  return { totalPayment, updatedLiabilities, byLiability, interestByLiability };
}
