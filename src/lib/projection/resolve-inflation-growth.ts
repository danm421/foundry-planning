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
// This module recomputes the resolved inflation rate from the effective plan
// settings and re-applies it to every inflation-sourced entity. Idempotent:
// when the rate is unchanged it returns the input tree unchanged. The scenario
// loader no longer depends on it: a scenario's growth & inflation edits reach
// the tree through an override base load (`growth-settings-override.ts`), so
// there it is a backstop whose rate comparison no-ops.

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
    // Asset transactions keep their source (the Income / Expense pattern), so
    // they re-resolve in place — no id set needed.
    assetTransactions: tree.assetTransactions?.map((t) =>
      t.propertyTaxGrowthSource === "inflation"
        ? { ...t, propertyTaxGrowthRate: newRate }
        : t,
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
