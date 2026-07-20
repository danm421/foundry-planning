// Pure per-side totals for the divorce workbench. No DB/Next imports — shared
// by the UI, commit preview, and commit engine.

import {
  allocationKey,
  dispositionSides,
  type DivisibleObject,
  type ResolvedAllocation,
} from "./allocation-rules";
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
  const objectById = new Map(objects.map((o) => [o.id, o]));
  for (const obj of objects) {
    const sign = obj.kind === "liability" ? -1 : 1;
    const add = (side: "primary" | "spouse", value: number) => {
      if (obj.kind === "income") sides[side].annualIncome += obj.annualAmount;
      else if (obj.kind === "expense") sides[side].annualExpenses += obj.annualAmount;
      else sides[side].netWorth += sign * value;
    };
    if (obj.entityOwnedById) {
      // An account CHILD's netWorth is already folded into its entity's value
      // (divisible-objects) — skip it. But a container-owned income/expense
      // carries a live annualAmount that belongs on whichever side(s) its
      // container lands on (entity or account container). Resolve the container's
      // disposition and add the amount there — duplicate counts on BOTH sides
      // (matching duplicateEntityIncomesExpenses), split → primary.
      if (obj.kind !== "income" && obj.kind !== "expense") continue;
      const container = objectById.get(obj.entityOwnedById);
      if (!container) continue;
      // A container account can itself be entity-owned (a trust-owned account
      // with a linked income) — follow it to the governing entity, mirroring
      // buildSideResolvers' accountSides.
      const cAlloc = container.entityOwnedById
        ? resolved.get(allocationKey("entity", container.entityOwnedById))
        : resolved.get(allocationKey(container.kind, container.id));
      for (const side of dispositionSides(cAlloc?.disposition)) add(side, 0);
      continue;
    }
    const alloc = resolved.get(allocationKey(obj.kind, obj.id));
    if (!alloc) continue;
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
