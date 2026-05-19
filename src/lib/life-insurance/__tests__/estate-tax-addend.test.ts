import { describe, it, expect } from "vitest";
import type { DrainAttribution, ProjectionYear } from "@/engine/types";
import { runLifeInsuranceWhatIf } from "@/engine/what-if/life-insurance-need";
import { computeEstateTaxAddend } from "../estate-tax-addend";
import { highNetWorthBase, hnwAssumptions } from "./test-helpers";

/** Independent re-derivation: sum totalEstateTax + IRD over death-event years. */
function expectedAddend(projection: ProjectionYear[]): number {
  return projection.reduce((sum, year) => {
    if (!year.estateTax) return sum;
    const ird = (year.estateTax.drainAttributions ?? [])
      .filter((a: DrainAttribution) => a.drainKind === "ird_tax")
      .reduce((t, a) => t + a.amount, 0);
    return sum + year.estateTax.totalEstateTax + ird;
  }, 0);
}

describe("computeEstateTaxAddend", () => {
  it("sums federal + state estate tax + IRD across death-event years", () => {
    const tree = highNetWorthBase();
    const projection = runLifeInsuranceWhatIf({
      data: tree,
      deceased: "client",
      deathYear: hnwAssumptions.deathYear,
      faceValue: 0,
      proceedsGrowthRate: hnwAssumptions.proceedsGrowthRate,
      livingExpenseAtDeath: hnwAssumptions.livingExpenseAtDeath,
      payoffLiabilityIds: hnwAssumptions.payoffLiabilityIds,
    });
    const addend = computeEstateTaxAddend(tree, "client", hnwAssumptions);
    expect(addend).toBe(expectedAddend(projection));
  });

  it("returns a positive addend for a high-net-worth estate", () => {
    const addend = computeEstateTaxAddend(highNetWorthBase(), "client", hnwAssumptions);
    expect(addend).toBeGreaterThan(0);
  });
});
