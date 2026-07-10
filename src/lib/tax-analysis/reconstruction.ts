import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { runCalc, type AdapterContext } from "./adapter";

export interface ReconstructionCheck {
  /** Engine pre-credit income tax: regular bracket tax + preferential
   *  cap-gains tax + AMT excess. Apples-to-apples with 1040 line 16 +
   *  Schedule 2 line 1 (both pre-credit) — avoids modeling credits. */
  computedPreCreditTax: number | null;
  filedPreCreditTax: number | null;
  delta: number | null; // computed - filed
  withinTolerance: boolean | null; // null when either side unavailable
}

export function runReconstruction(
  facts: TaxReturnFacts,
  ctx: AdapterContext,
): ReconstructionCheck {
  const r = runCalc(facts, ctx);
  const computed = r
    ? r.flow.regularTaxCalc + r.flow.capitalGainsTax + r.flow.amtAdditional
    : null;
  const filed =
    facts.tax.taxBeforeCredits != null
      ? facts.tax.taxBeforeCredits + (facts.tax.amt ?? 0)
      : null;
  if (computed == null || filed == null) {
    return { computedPreCreditTax: computed, filedPreCreditTax: filed, delta: null, withinTolerance: null };
  }
  const delta = computed - filed;
  const tolerance = Math.max(100, 0.02 * Math.abs(filed));
  return {
    computedPreCreditTax: computed,
    filedPreCreditTax: filed,
    delta,
    withinTolerance: Math.abs(delta) <= tolerance,
  };
}
