import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { TaxResult } from "@/lib/tax/types";

export interface ReconstructionCheck {
  /** Engine pre-credit income tax: regular bracket tax + preferential
   *  cap-gains tax + AMT excess. Apples-to-apples with 1040 line 16 +
   *  Schedule 2 line 1 (both pre-credit) — avoids modeling credits. */
  computedPreCreditTax: number | null;
  filedPreCreditTax: number | null;
  delta: number | null; // computed - filed
  withinTolerance: boolean | null; // null when either side unavailable
}

/** `calc` is the engine run for these facts — precomputed once by the
 *  caller (buildTaxAnalysis) rather than re-run here. */
export function runReconstruction(
  facts: TaxReturnFacts,
  calc: TaxResult | null,
): ReconstructionCheck {
  const computed = calc
    ? calc.flow.regularTaxCalc + calc.flow.capitalGainsTax + calc.flow.amtAdditional
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
