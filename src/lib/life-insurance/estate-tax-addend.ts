// src/lib/life-insurance/estate-tax-addend.ts
//
// "Cover estate taxes" addend for the Life Insurance solver.
//
// When the advisor enables the toggle, the solve target gains the household's
// total estate taxes: federal estate tax + state estate tax + income tax on
// IRD (retirement accounts inherited as income in respect of a decedent).
//
// The addend is a SNAPSHOT — computed once from the face-value-0 what-if
// projection (existing coverage only), not recomputed as the solver raises
// coverage. See the design spec for the accepted understatement when proceeds
// land in-estate.
import type { ClientData, ProjectionYear } from "@/engine/types";
import { runLifeInsuranceWhatIf } from "@/engine/what-if/life-insurance-need";
import type { LifeInsuranceAssumptions } from "./solve-need";

/** Income tax on IRD for one projection year — the engine tracks it as a
 *  `drainAttribution` with `drainKind: "ird_tax"`. */
function irdTax(year: ProjectionYear): number {
  return (year.estateTax?.drainAttributions ?? [])
    .filter((a) => a.drainKind === "ird_tax")
    .reduce((sum, a) => sum + a.amount, 0);
}

// NOTE on death-event years: this sums across BOTH the insured's premature
// death and the survivor's final death. At the first death, the engine drains
// `portfolioAssets` by the first-death estate tax before the survivor's
// projection continues (projection.ts:~3727), so the solver — even with the
// toggle OFF — already raises coverage to overcome that drain. Adding the
// first-death tax to the addend therefore double-counts that component.
//
// In the common married case the unlimited marital deduction zeroes the first-
// death estate tax (and retirement accounts roll over to the spouse with no
// IRD income tax at first death), so the double-count is numerically zero.
// In edge cases (large first-death non-spousal estate, blended families) it
// remains a known accepted approximation. A future refinement could filter to
// the survivor's final-death year only — see future-work/engine.md.

/** Sum of federal + state estate tax + IRD income tax across a what-if
 *  projection's death-event years. Pure — lets a caller reuse a face-0
 *  projection it already ran (see need-over-time's fused solve). */
export function estateTaxAddendFromProjection(projection: ProjectionYear[]): number {
  return projection.reduce((sum, year) => {
    if (!year.estateTax) return sum;
    return sum + year.estateTax.totalEstateTax + irdTax(year);
  }, 0);
}

/**
 * Total estate taxes — federal + state estate tax + IRD income tax — owed
 * across the death-event years of `deceased`'s what-if projection (the
 * insured's premature death plus the survivor's eventual death).
 *
 * Computed from the face-value-0 projection so the figure is a fixed addend,
 * independent of the coverage the solver lands on. Estate admin / settlement
 * expenses are deliberately excluded — they are not taxes and the engine
 * already models them as a projection drain.
 */
export function computeEstateTaxAddend(
  tree: ClientData,
  deceased: "client" | "spouse",
  a: LifeInsuranceAssumptions,
): number {
  const projection = runLifeInsuranceWhatIf({
    data: tree,
    deceased,
    deathYear: a.deathYear,
    faceValue: 0,
    proceedsGrowthRate: a.proceedsGrowthRate,
    proceedsRealization: a.proceedsRealization,
    livingExpenseAtDeath: a.livingExpenseAtDeath,
    payoffLiabilityIds: a.payoffLiabilityIds,
  });
  return estateTaxAddendFromProjection(projection);
}
