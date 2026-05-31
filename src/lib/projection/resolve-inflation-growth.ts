// src/lib/projection/resolve-inflation-growth.ts
//
// Re-resolution of inflation-driven growth rates under a scenario-edited
// inflation rate.
//
// Base accounts / incomes / expenses / savings rules have their growthRate
// resolved at base-load time from the plan's inflation rate. A scenario edit to
// `plan_settings.inflationRate` updates `effectiveTree.planSettings`, but the
// already-resolved base-entity growth rates would otherwise stay stale — the
// overlay sits on a pre-resolved tree.
//
// The growth-source resolver is invariant under a scenario: the CMA /
// model-portfolio / category fields it reads are NOT carried on the
// scenario-editable `EnginePlanSettings`, so the ONLY resolution input a
// scenario can change is the resolved inflation rate. This module recomputes
// that rate from the effective plan settings and re-applies it to every
// inflation-sourced entity. Idempotent: when the rate is unchanged it returns
// the input tree unchanged.

import type { ClientData } from "@/engine/types";
import { resolveInflationRate } from "@/lib/inflation";
import type { ResolutionContext } from "./resolve-entity";

/**
 * Re-resolve inflation-driven growth rates against the effective plan's
 * inflation rate. Income / Expense / SavingsRule retain `growthSource`, so they
 * are re-resolved in place; the engine `Account` drops it, so accounts are
 * re-resolved via the `accountGrowthFromInflation` /
 * `accountPropertyTaxFromInflation` id sets captured at base-load time.
 *
 * Returns the SAME tree reference when the resolved inflation rate is unchanged
 * (or the context lacks the inputs), so the no-scenario-inflation-change path
 * is byte-identical.
 */
export function reResolveInflationGrowth(
  tree: ClientData,
  ctx: ResolutionContext,
): ClientData {
  const inputs = ctx.resolvedInflationInputs;
  if (!inputs) return tree;

  const newRate = resolveInflationRate(
    {
      inflationRateSource: inputs.inflationRateSource,
      inflationRate: tree.planSettings.inflationRate,
    },
    inputs.inflationClass,
    inputs.clientOverride,
  );

  if (newRate === ctx.resolvedInflationRate) return tree;

  const growthSet = ctx.accountGrowthFromInflation ?? new Set<string>();
  const propertyTaxSet = ctx.accountPropertyTaxFromInflation ?? new Set<string>();

  return {
    ...tree,
    incomes: tree.incomes.map((i) =>
      i.growthSource === "inflation" ? { ...i, growthRate: newRate } : i,
    ),
    expenses: tree.expenses.map((e) =>
      e.growthSource === "inflation" ? { ...e, growthRate: newRate } : e,
    ),
    savingsRules: tree.savingsRules.map((s) =>
      s.growthSource === "inflation" ? { ...s, growthRate: newRate } : s,
    ),
    accounts: tree.accounts.map((a) => {
      const growth = growthSet.has(a.id);
      const propertyTax = propertyTaxSet.has(a.id);
      if (!growth && !propertyTax) return a;
      const next = { ...a };
      if (growth) next.growthRate = newRate;
      if (propertyTax) next.propertyTaxGrowthRate = newRate;
      return next;
    }),
  };
}
