// The household's savings rate — ONE definition, shared by every sheet that
// prints it.

import type { ProjectionYear } from "@/engine/types";

/**
 * What the plan actually saves, as a share of the pay it is saved out of.
 *
 * Both Early Years sheets print this rate and they must print the same one.
 * They used to compute it two ways: the standing sheet from the projection,
 * the ladder by summing the savings rules' own `annualPercent`s. On a
 * two-earner household that produced 5% on one sheet and 12% on the next, in
 * one PDF. Summed rule percents are not a rate — the engine resolves each
 * percent against the ACCOUNT OWNER's salary slice (`salaryByRuleId` in
 * `projection.ts`), so the sum is arithmetic across different denominators,
 * and it also ignores the §402(g) deferral cap. What the engine contributed is
 * the only quantity that cannot promise a deferral the IRS limit will refuse.
 *
 * Zero when there is no salary to divide by: a rate has no denominator there,
 * and callers say "we can't state this" rather than printing a 0% that reads
 * as "you save nothing".
 */
export function householdSavingsRate(year: ProjectionYear | undefined): number {
  if (!year || year.income.salaries <= 0) return 0;
  return year.savings.total / year.income.salaries;
}
