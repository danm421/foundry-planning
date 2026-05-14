//
// Pure filter: returns the subset of savings rules whose [startYear, endYear]
// window includes the given year (inclusive on both ends).

import type { SavingsRule } from "@/engine/types";

export function activeSavingsRules(
  rules: SavingsRule[],
  currentYear: number,
): SavingsRule[] {
  return rules.filter(
    (r) => r.startYear <= currentYear && currentYear <= r.endYear,
  );
}
