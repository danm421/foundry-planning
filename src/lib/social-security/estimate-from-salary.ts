import { BEND_POINTS, DEFAULT_SS_WAGE_BASE } from "@/engine/socialSecurity/constants";
import { estimatePiaMonthly, MAX_CREDITED_YEARS } from "@/engine/socialSecurity/estimatePia";

/** SSA averages the highest 35 years, so crediting the stated salary for all of
 *  them is the "they earned this their whole career" assumption. Not 40
 *  quarters — that is the eligibility minimum, and dividing by the same 420
 *  months would return a figure no advisor would recognise. */
export const FULL_CAREER_YEARS = MAX_CREDITED_YEARS;

/** The subset of an income row this module reads. Accepts the raw API shape,
 *  where `annualAmount` arrives as a decimal string. */
export interface SalaryLike {
  type: string;
  owner: string;
  annualAmount: number | string | null;
  endYear?: number | null;
}

/**
 * Total current covered wages for one person, in today's dollars.
 *
 * Sums every salary row they own, because Social Security credits all covered
 * wages in a year against one cap. Rows that have already ended are excluded —
 * a job that stopped in 2020 is not what "their current salary" means — but a
 * row that has not started yet is kept, so entering next year's salary
 * produces an estimate immediately.
 *
 * `joint` rows are excluded: Social Security is credited to an individual
 * earnings record, so a jointly-owned salary belongs to neither person's PIA.
 */
export function ownerAnnualSalary(
  rows: readonly SalaryLike[],
  owner: "client" | "spouse",
  currentYear: number,
): number {
  return rows.reduce((sum, row) => {
    if (row.type !== "salary" || row.owner !== owner) return sum;
    if (row.endYear != null && row.endYear < currentYear) return sum;
    const amount = Number(row.annualAmount);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
}

/**
 * Monthly PIA at Full Retirement Age implied by a salary, in today's dollars.
 *
 * Rounded to whole dollars: this feeds a dollar-denominated input, and the
 * underlying estimate is specified to a plus-or-minus-10% tolerance, so cents
 * would be false precision.
 */
export function estimatePiaFromSalary(annualSalary: number): number {
  return Math.round(
    estimatePiaMonthly({
      highestAnnualSalary: annualSalary,
      yearsEmployed: FULL_CAREER_YEARS,
      futureYears: 0,
      ssWageBase: DEFAULT_SS_WAGE_BASE,
      bendPoints: { first: BEND_POINTS.first, second: BEND_POINTS.second },
    }),
  );
}
