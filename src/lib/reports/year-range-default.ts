import type { YearRange } from "./types";

export function resolveYearRange(
  value: YearRange,
  household: { retirementYear: number; currentYear: number },
): { from: number; to: number } {
  const defaultFrom = household.currentYear;
  const defaultTo = household.retirementYear + 25;       // spec: retirement year + 25
  return {
    from: value.from === "default" ? defaultFrom : value.from,
    to: value.to === "default" ? defaultTo : value.to,
  };
}
