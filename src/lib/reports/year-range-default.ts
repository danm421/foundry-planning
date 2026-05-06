import type { YearRange } from "./types";

export function resolveYearRange(
  value: YearRange,
  household: { retirementAge: number; currentYear: number },
): { from: number; to: number } {
  const defaultFrom = household.currentYear;
  const defaultTo = household.retirementAge + 25;       // matches spec: retirementAge + 25
  return {
    from: value.from === "default" ? defaultFrom : value.from,
    to: value.to === "default" ? defaultTo : value.to,
  };
}
