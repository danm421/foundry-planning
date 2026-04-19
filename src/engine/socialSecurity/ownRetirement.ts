// src/engine/socialSecurity/ownRetirement.ts
import { fraForBirthDate } from "./fra";
import {
  EARLY_RETIREMENT_FIRST_36_PCT_PER_MONTH,
  EARLY_RETIREMENT_EXTENDED_PCT_PER_MONTH,
  EARLY_REDUCTION_FIRST_TIER_MONTHS,
  DRC_PCT_PER_MONTH,
  AGE_70_MONTHS,
} from "./constants";

export interface OwnBenefitInput {
  piaMonthly: number;
  claimAgeMonths: number; // years*12 + months
  dob: string;            // YYYY-MM-DD
}

/**
 * Compute the worker's own monthly retirement benefit given their PIA, claim
 * age, and date of birth.
 *
 * Behavior:
 * - **Claim at FRA**: returns `piaMonthly` unchanged.
 * - **Early claim** (before FRA): reduces PIA by 5/9% per month for the first
 *   36 months early, then 5/12% per month for each additional month early.
 * - **Delayed claim** (after FRA): increases PIA by 2/3% per month (DRC),
 *   capped at age 70 — no additional credit accrues beyond 70.
 * - **PIA = 0**: returns 0 regardless of claim age.
 *
 * @param input.piaMonthly  Worker's Primary Insurance Amount in dollars/month.
 * @param input.claimAgeMonths  Age at which the worker claims, expressed as
 *   total months (e.g. 67y 0m = 804).
 * @param input.dob  Worker's date of birth in `YYYY-MM-DD` format.
 *
 * @remarks Assumes `claimAgeMonths >= 0` (enforced by DB schema and UI form constraints).
 */
export function computeOwnMonthlyBenefit(input: OwnBenefitInput): number {
  if (input.piaMonthly <= 0) return 0;
  const fra = fraForBirthDate(input.dob);
  const offset = input.claimAgeMonths - fra.totalMonths;

  if (offset === 0) return input.piaMonthly;

  if (offset < 0) {
    const m = -offset;
    const first = Math.min(m, EARLY_REDUCTION_FIRST_TIER_MONTHS) * EARLY_RETIREMENT_FIRST_36_PCT_PER_MONTH;
    const extended = Math.max(m - EARLY_REDUCTION_FIRST_TIER_MONTHS, 0) * EARLY_RETIREMENT_EXTENDED_PCT_PER_MONTH;
    return input.piaMonthly * (1 - first - extended);
  }

  // Delayed: cap at age 70
  const maxDrcMonths = AGE_70_MONTHS - fra.totalMonths;
  const m = Math.min(offset, maxDrcMonths);
  return input.piaMonthly * (1 + m * DRC_PCT_PER_MONTH);
}
