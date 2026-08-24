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

/** The subset of a Social Security row this module reads. Accepts the raw API
 *  shape, where `piaMonthly` arrives as a decimal string. */
export interface SsRowLike extends SalaryLike {
  ssBenefitMode?: string | null;
  piaMonthly?: number | string | null;
}

/**
 * The PIA a Social Security row should use when nobody has entered one, or null
 * to leave the row exactly as stored.
 *
 * An advisor who has entered a salary has already told us roughly what Social
 * Security will pay. Making them open the Social Security dialog and press Save
 * before that money appears in the projection means every plan nobody has got
 * round to understates retirement income by the household's whole benefit — so
 * the estimate is DERIVED at load instead. Nothing is written: it follows the
 * salary if the salary changes, and an entered PIA always wins.
 *
 * Only `pia_at_fra` rows are filled. `manual_amount` and `no_benefit` are
 * answers somebody gave — the first is paid off `annualAmount`, the second pays
 * nothing on purpose — and a stored NULL reads as `manual_amount` on every
 * surface (`SocialSecurityCard`, `SocialSecurityDialog`, `household-map/goals`),
 * so filling any of the three would show a figure the engine never pays.
 */
export function estimatedPiaMonthly(
  row: SsRowLike,
  rows: readonly SalaryLike[],
  currentYear: number,
): number | null {
  if (row.type !== "social_security") return null;
  if (row.ssBenefitMode !== "pia_at_fra") return null;
  // A seeded row stores NULL; an imported one can store "0". Both mean unset.
  if (Number(row.piaMonthly ?? 0) > 0) return null;
  // `joint` has no earnings record to estimate from — see `ownerAnnualSalary`.
  if (row.owner !== "client" && row.owner !== "spouse") return null;

  // No salary estimates to $0, and so does one too small to earn a credit —
  // both are "we cannot say", which is the stored row's own answer.
  const pia = estimatePiaFromSalary(ownerAnnualSalary(rows, row.owner, currentYear));
  return pia > 0 ? pia : null;
}
