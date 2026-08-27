import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { TaxResult } from "@/lib/tax/types";
import { fmtUsd } from "./format";

export interface ReconstructionCheck {
  /** Engine pre-credit income tax: regular bracket tax + preferential
   *  cap-gains tax + AMT excess. Apples-to-apples with 1040 line 16 +
   *  Schedule 2 line 1 (both pre-credit) — avoids modeling credits.
   *  When `amtExcluded` is true, AMT is out of BOTH this and `filedPreCreditTax`. */
  computedPreCreditTax: number | null;
  filedPreCreditTax: number | null;
  delta: number | null; // computed - filed
  withinTolerance: boolean | null; // null when either side unavailable
  /** The return reports AMT that this model produced none of, so AMT was
   *  dropped from both sides of the comparison. */
  amtExcluded: boolean;
  /** The filed AMT that was set aside — for the note. Null when there is none. */
  filedAmt: number | null;
}

/** `calc` is the engine run for these facts — precomputed once by the
 *  caller (buildTaxAnalysis) rather than re-run here. */
export function runReconstruction(
  facts: TaxReturnFacts,
  calc: TaxResult | null,
): ReconstructionCheck {
  const filedAmt = facts.tax.amt ?? 0;
  // The adapter passes no option spread and no other AMT preference — the
  // extraction schema has no field for one — so a return that paid AMT leaves a
  // gap this MODEL created, not one the document scan did. Comparing against it
  // produced a five-figure "discrepancy" and a sentence telling the advisor to
  // re-verify figures that were read correctly, on a client-facing PDF. Set the
  // AMT aside on BOTH sides instead, so the rest of the return is still genuinely
  // checked, and say plainly that the filed AMT is not reproduced.
  //
  // Keyed on the FILED figure alone, deliberately. The model can still produce a
  // little AMT of its own from the standard-deduction or SALT add-back, and
  // gating on "the model produced none" would hand those returns the old
  // behaviour back in full — a five-figure delta and the "verify the extracted
  // figures" sentence — on an arbitrary subset. Whatever AMT this model computes
  // without any preference input is not a reconstruction of the filed one.
  // When the extraction learns to read preference items (audit F8, part 2), this
  // is the line that has to change with it.
  const amtExcluded = filedAmt > 0;

  const computed = calc
    ? calc.flow.regularTaxCalc +
      calc.flow.capitalGainsTax +
      (amtExcluded ? 0 : calc.flow.amtAdditional)
    : null;
  const filed =
    facts.tax.taxBeforeCredits != null
      ? facts.tax.taxBeforeCredits + (amtExcluded ? 0 : filedAmt)
      : null;
  const base = {
    computedPreCreditTax: computed,
    filedPreCreditTax: filed,
    amtExcluded,
    filedAmt: amtExcluded ? filedAmt : null,
  };
  if (computed == null || filed == null) {
    return { ...base, delta: null, withinTolerance: null };
  }
  const delta = computed - filed;
  const tolerance = Math.max(100, 0.02 * Math.abs(filed));
  return { ...base, delta, withinTolerance: Math.abs(delta) <= tolerance };
}

/**
 * The report footer: the cross-check sentence (empty when we couldn't run one)
 * followed by the disclaimer. Shared by the report view and the PDF because
 * "is not tax advice" is compliance copy on a client deliverable and must be
 * byte-identical on both surfaces — two encodings of the same three-state
 * conditional is exactly where one arm gets fixed on one surface only.
 */
export function reconstructionNote(r: ReconstructionCheck): string {
  // Leads, so an advisor reads why AMT is missing before reading the comparison
  // it was taken out of. The "verify the extracted figures" sentence below now
  // only ever speaks to a gap the extraction could actually explain. Gated on a
  // cross-check having actually run — with no comparison there is nothing for
  // AMT to have been excluded FROM, and the sentence would dangle.
  const amtNote =
    r.amtExcluded && r.withinTolerance !== null
      ? `The ${fmtUsd(r.filedAmt ?? 0)} of alternative minimum tax on this return is not reproduced by this model, which does not read the items that create it, so AMT is excluded from the cross-check. `
      : "";
  const crossCheck =
    r.withinTolerance === true
      ? "Cross-check: our independent computation of this return's pre-credit tax matches the filed amount. "
      : r.withinTolerance === false
        ? `Cross-check: our computed pre-credit tax (${fmtUsd(r.computedPreCreditTax ?? 0)}) differs from the filed amount — verify the extracted figures. `
        : "";
  return `${amtNote}${crossCheck}This analysis is informational, based on the return as provided, and is not tax advice.`;
}
