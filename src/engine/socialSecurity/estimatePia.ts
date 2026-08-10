/** Months in the 35-year averaging period SSA uses. */
const AVERAGING_MONTHS = 35 * 12;
export const MAX_CREDITED_YEARS = 35;

const BAND_1_RATE = 0.9;
const BAND_2_RATE = 0.32;
const BAND_3_RATE = 0.15;

export interface EstimatePiaInput {
  /** Highest annual covered earnings, in today's dollars. */
  highestAnnualSalary: number;
  /** Years already worked, read off the document. */
  yearsEmployed: number;
  /**
   * Additional years to the owner's retirement, computed by the CALLER as
   * (retirementAge - currentAge). Passed in rather than derived here so this
   * module stays free of Date.now() and the engine stays pure.
   */
  futureYears: number;
  /** Current-year Social Security wage base; caps covered earnings. */
  ssWageBase: number;
  /** Monthly bend points for the current year. See BEND_POINTS. */
  bendPoints: { first: number; second: number };
}

/**
 * Estimate a worker's Primary Insurance Amount in TODAY'S DOLLARS.
 *
 * This approximates SSA's method rather than reproducing it. SSA averages the
 * highest 35 years of WAGE-INDEXED earnings; a true reproduction would need
 * future wage-index assumptions, which are themselves guesses and buy nothing
 * at the plus-or-minus-10% tolerance planning works at. We instead credit the
 * worker's stated peak earnings for every year they work, up to 35, and let the
 * existing inflation machinery carry the result forward.
 *
 * Pure: no Date.now, no Math.random, no IO.
 */
export function estimatePiaMonthly(input: EstimatePiaInput): number {
  const { highestAnnualSalary, yearsEmployed, futureYears, ssWageBase, bendPoints } = input;

  if (highestAnnualSalary <= 0) return 0;
  const creditedYears = Math.min(
    Math.max(yearsEmployed, 0) + Math.max(futureYears, 0),
    MAX_CREDITED_YEARS,
  );
  if (creditedYears <= 0) return 0;

  const coveredAnnual = Math.min(highestAnnualSalary, ssWageBase);
  const aime = (coveredAnnual * creditedYears) / AVERAGING_MONTHS;

  const band1 = Math.min(aime, bendPoints.first);
  const band2 = Math.max(0, Math.min(aime, bendPoints.second) - bendPoints.first);
  const band3 = Math.max(0, aime - bendPoints.second);

  return BAND_1_RATE * band1 + BAND_2_RATE * band2 + BAND_3_RATE * band3;
}
