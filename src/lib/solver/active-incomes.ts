//
// Pure filter: returns the subset of non-SS income streams whose
// [startYear, endYear] window includes the given year (inclusive on both ends).
// Social Security is handled by its own dedicated solver row.

import type { Income } from "@/engine/types";

export function activeIncomes(
  incomes: Income[],
  currentYear: number,
): Income[] {
  return incomes.filter(
    (i) =>
      i.type !== "social_security" &&
      i.startYear <= currentYear &&
      currentYear <= i.endYear,
  );
}
