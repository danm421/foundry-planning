// src/engine/socialSecurity/spousal.ts
import { fraForBirthDate } from "./fra";
import {
  EARLY_SPOUSAL_FIRST_36_PCT_PER_MONTH,
  EARLY_SPOUSAL_EXTENDED_PCT_PER_MONTH,
  EARLY_REDUCTION_FIRST_TIER_MONTHS,
} from "./constants";

export interface SpousalBenefitInput {
  otherPiaMonthly: number;
  otherSpouseHasClaimed: boolean;
  claimAgeMonths: number;
  dob: string;
}

/**
 * Compute the spousal monthly benefit for a worker given their spouse's PIA,
 * claim age, and date of birth.
 *
 * Behavior:
 * - **Spouse not yet claimed**: returns 0 (deeming rule — spousal benefit
 *   requires the other spouse to have filed).
 * - **Other PIA = 0**: returns 0.
 * - **Claim at or after FRA**: returns 50% of `otherPiaMonthly` (no DRC
 *   applies to spousal benefits — delayed claiming beyond FRA earns nothing
 *   extra on the spousal portion).
 * - **Early claim** (before FRA): reduces the 50%-base by 25/36% per month
 *   for the first 36 months early, then 5/12% per month for each additional
 *   month early (§5.4.1).
 *
 * @param input.otherPiaMonthly  Spouse's Primary Insurance Amount in dollars/month.
 * @param input.otherSpouseHasClaimed  Whether the other spouse has already filed.
 * @param input.claimAgeMonths  Age at which this worker claims spousal benefit,
 *   expressed as total months (e.g. 67y 0m = 804).
 * @param input.dob  This worker's date of birth in `YYYY-MM-DD` format.
 */
export function computeSpousalMonthlyBenefit(input: SpousalBenefitInput): number {
  if (!input.otherSpouseHasClaimed) return 0;
  if (input.otherPiaMonthly <= 0) return 0;

  const base = input.otherPiaMonthly * 0.5;
  const fra = fraForBirthDate(input.dob);
  const offset = input.claimAgeMonths - fra.totalMonths;

  if (offset >= 0) return base;  // no DRC on spousal

  const m = -offset;
  const first = Math.min(m, EARLY_REDUCTION_FIRST_TIER_MONTHS) * EARLY_SPOUSAL_FIRST_36_PCT_PER_MONTH;
  const extended = Math.max(m - EARLY_REDUCTION_FIRST_TIER_MONTHS, 0) * EARLY_SPOUSAL_EXTENDED_PCT_PER_MONTH;
  return base * (1 - first - extended);
}

/**
 * Retirement-first top-up decomposition (§5.4.2).
 * Given independently-reduced own and spousal monthly amounts, returns
 * the combined total plus the correct breakdown for reporting.
 */
export function topUp(own: number, spousal: number): {
  total: number;
  retirement: number;
  spousalPortion: number;
} {
  if (own >= spousal) return { total: own, retirement: own, spousalPortion: 0 };
  return { total: spousal, retirement: own, spousalPortion: spousal - own };
}
