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
  return projection.reduce((sum, year) => {
    if (!year.estateTax) return sum;
    return sum + year.estateTax.totalEstateTax + irdTax(year);
  }, 0);
}
