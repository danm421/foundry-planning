import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { TaxResult } from "@/lib/tax/types";
import { fmtUsd } from "./format";

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

/**
 * The report footer: the cross-check sentence (empty when we couldn't run one)
 * followed by the disclaimer. Shared by the report view and the PDF because
 * "is not tax advice" is compliance copy on a client deliverable and must be
 * byte-identical on both surfaces — two encodings of the same three-state
 * conditional is exactly where one arm gets fixed on one surface only.
 */
export function reconstructionNote(r: ReconstructionCheck): string {
  const crossCheck =
    r.withinTolerance === true
      ? "Cross-check: our independent computation of this return's pre-credit tax matches the filed amount. "
      : r.withinTolerance === false
        ? `Cross-check: our computed pre-credit tax (${fmtUsd(r.computedPreCreditTax ?? 0)}) differs from the filed amount — verify the extracted figures. `
        : "";
  return `${crossCheck}This analysis is informational, based on the return as provided, and is not tax advice.`;
}
