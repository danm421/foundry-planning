// Pure per-side totals for the divorce workbench. No DB/Next imports — shared
// by the UI, commit preview, and commit engine.

import { allocationKey, type DivisibleObject, type ResolvedAllocation } from "./allocation-rules";
import { splitAmounts } from "./split-math";

export interface SideTotals {
  netWorth: number;
  annualIncome: number;
  annualExpenses: number;
}

export function computeSideTotals(
  objects: DivisibleObject[],
  resolved: Map<string, ResolvedAllocation>,
): { primary: SideTotals; spouse: SideTotals } {
  const zero = (): SideTotals => ({ netWorth: 0, annualIncome: 0, annualExpenses: 0 });
  const sides = { primary: zero(), spouse: zero() };
  for (const obj of objects) {
    if (obj.entityOwnedById) continue; // counted inside its entity's value
    const alloc = resolved.get(allocationKey(obj.kind, obj.id));
    if (!alloc) continue;
    const sign = obj.kind === "liability" ? -1 : 1;
    const add = (side: "primary" | "spouse", value: number) => {
      if (obj.kind === "income") sides[side].annualIncome += obj.annualAmount;
      else if (obj.kind === "expense") sides[side].annualExpenses += obj.annualAmount;
      else sides[side].netWorth += sign * value;
    };
    if (alloc.disposition === "split" && alloc.splitPercentToSpouse != null) {
      const r = splitAmounts(obj.value, obj.basis, obj.rothValue, alloc.splitPercentToSpouse);
      add("primary", r.primary.value);
      add("spouse", r.spouse.value);
    } else if (alloc.disposition === "duplicate") {
      add("primary", obj.value);
      add("spouse", obj.value);
    } else {
      add(alloc.disposition === "spouse" ? "spouse" : "primary", obj.value);
    }
  }
  return sides;
}
