import { describe, it, expect } from "vitest";
import type { DrainAttribution, ProjectionYear } from "@/engine/types";
import { runLifeInsuranceWhatIf } from "@/engine/what-if/life-insurance-need";
import {
  computeEstateTaxAddend,
  estateTaxAddendFromProjection,
} from "../estate-tax-addend";
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
    // Parity: addend must equal the independent re-derivation from the projection.
    expect(addend).toBe(expectedAddend(projection));
    // Regression guard: pin the concrete dollar value so a future engine change
    // that silently shifts estate-tax math is caught here. Tolerance ±$1 000
    // (toBeCloseTo exponent -3 means nearest 10^3 = 1000).
    // Value observed 2026-05-19: ~$12 638 270.
    expect(addend).toBeCloseTo(12_638_270, -3);
  });

  it("returns a positive addend for a high-net-worth estate", () => {
    const addend = computeEstateTaxAddend(highNetWorthBase(), "client", hnwAssumptions);
    expect(addend).toBeGreaterThan(0);
  });

  it("estateTaxAddendFromProjection equals computeEstateTaxAddend on the same face-0 projection", () => {
    const tree = highNetWorthBase();
    const projection = runLifeInsuranceWhatIf({
      data: tree,
      deceased: "client",
      deathYear: hnwAssumptions.deathYear,
      faceValue: 0,
      proceedsGrowthRate: hnwAssumptions.proceedsGrowthRate,
      proceedsRealization: hnwAssumptions.proceedsRealization,
      livingExpenseAtDeath: hnwAssumptions.livingExpenseAtDeath,
      payoffLiabilityIds: hnwAssumptions.payoffLiabilityIds,
    });
    expect(estateTaxAddendFromProjection(projection)).toBe(
      computeEstateTaxAddend(tree, "client", hnwAssumptions),
    );
  });
});
