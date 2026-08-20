//
// Pure filter: the "other" (miscellaneous) expenses whose [startYear, endYear]
// window includes the given year. Living expenses have their own solver row
// (with the scale lever), insurance premiums are policy-synthesized, and
// education goals belong to the Education tab — so this covers exactly the
// category the solver's "+ Add income or expense" popup writes into.

import type { Expense } from "@/engine/types";

export function activeOtherExpenses(
  expenses: Expense[],
  currentYear: number,
): Expense[] {
  return expenses.filter(
    (e) =>
      e.type === "other" &&
      e.startYear <= currentYear &&
      currentYear <= e.endYear,
  );
}
