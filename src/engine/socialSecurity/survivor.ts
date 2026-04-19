// src/engine/socialSecurity/survivor.ts
import { survivorFraForBirthDate } from "./fra";
import {
  SURVIVOR_FLOOR_PCT_OF_PIA,
  DRC_PCT_PER_MONTH,
} from "./constants";

export interface SurvivorBenefitInput {
  deceasedPiaMonthly: number;
  /** True if deceased filed for benefits before their own FRA. */
  deceasedFiledBeforeFra: boolean;
  /** Deceased's actual reduced benefit (relevant only when filed before FRA). */
  deceasedReducedBenefit: number;
  /** True if deceased never filed (died before or after FRA without filing). */
  deceasedNeverFiled: boolean;
  /** Months past FRA at time of death — used for Case D only (died after FRA, never filed). Capped at 36 by caller. */
  deceasedDrcMonths: number;
  /** Survivor's age this year in total months. */
  survivorAgeMonths: number;
  /** Survivor's DOB (YYYY-MM-DD) for survivor-FRA lookup. */
  survivorDob: string;
}

/**
 * Compute the monthly survivor benefit payable to a widow(er).
 *
 * Four cases determine the maximum survivor benefit (§5.6.5):
 *
 * - **Case A** — deceased filed *before* their own FRA:
 *   `max(deceasedReducedBenefit, 82.5% × PIA)`.
 * - **Case B** — deceased filed *at or after* their own FRA:
 *   the full benefit the deceased was receiving (including any DRC).
 * - **Case C** — deceased *never filed* and died *before* FRA:
 *   `100% × PIA`.
 * - **Case D** — deceased *never filed* and died *at or after* FRA:
 *   `PIA × (1 + deceasedDrcMonths × DRC_PCT_PER_MONTH)`.
 *
 * After computing `maxSurvivor`, an early-claim reduction is applied
 * if the survivor claims before their own survivor-FRA:
 * `maxSurvivor × (1 − monthsEarly × monthlyReductionPct)`.
 */
export function computeSurvivorMonthlyBenefit(input: SurvivorBenefitInput): number {
  if (input.deceasedPiaMonthly <= 0) return 0;

  // Compute the maximum survivor benefit per the four cases in §5.6.5
  let maxSurvivor: number;
  if (input.deceasedNeverFiled) {
    if (input.deceasedDrcMonths > 0) {
      // Case D: died at/after FRA without filing
      maxSurvivor = input.deceasedPiaMonthly * (1 + input.deceasedDrcMonths * DRC_PCT_PER_MONTH);
    } else {
      // Case C: died before FRA without filing
      maxSurvivor = input.deceasedPiaMonthly;
    }
  } else if (input.deceasedFiledBeforeFra) {
    // Case A: filed before FRA. Floor of 82.5% × PIA.
    maxSurvivor = Math.max(
      input.deceasedReducedBenefit,
      SURVIVOR_FLOOR_PCT_OF_PIA * input.deceasedPiaMonthly,
    );
  } else {
    // Case B: filed at/after FRA. Benefit as-is (includes any DRC).
    maxSurvivor = input.deceasedReducedBenefit;
  }

  // Apply early-survivor reduction if claiming before survivor-FRA
  const sFra = survivorFraForBirthDate(input.survivorDob);
  if (input.survivorAgeMonths >= sFra.totalMonths) return maxSurvivor;

  const monthsEarly = sFra.totalMonths - input.survivorAgeMonths;
  const reductionPct = monthsEarly * sFra.monthlyReductionPct;
  return maxSurvivor * (1 - reductionPct);
}
