import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "../projection";
import { buildMarriedEstateFixture } from "./fixtures/married-estate-fixture";

describe("anchored per-year hypothetical (integration)", () => {
  it("freezes the first death and models survivor-at-N past F", () => {
    const data = buildMarriedEstateFixture();
    const result = runProjectionWithEvents(data);
    const F = result.firstDeathEvent!.year;
    const second = result.secondDeathEvent!.year;
    expect(second).toBeGreaterThan(F);

    const rowAfterF = result.years.find((y) => y.year === F + 1)!;
    const anchored = rowAfterF.hypotheticalEstateTax!.primaryFirst;

    // First death is frozen to the REAL first decedent + real first-death tax.
    expect(anchored.firstDecedent).toBe(result.firstDeathEvent!.deceased);
    expect(anchored.firstDeath.grossEstate).toBe(result.firstDeathEvent!.grossEstate);
    // No spouseFirst ordering once anchored.
    expect(rowAfterF.hypotheticalEstateTax!.spouseFirst).toBeUndefined();

    // The frozen first death is identical for two different post-F years.
    const rowLater = result.years.find((y) => y.year === second)!;
    expect(rowLater.hypotheticalEstateTax!.primaryFirst.firstDeath.grossEstate).toBe(
      anchored.firstDeath.grossEstate,
    );
  });

  it("keeps both-die semantics for years at/before the first death", () => {
    const data = buildMarriedEstateFixture();
    const result = runProjectionWithEvents(data);
    const F = result.firstDeathEvent!.year;
    const beforeF = result.years.find((y) => y.year === F - 1)!;
    // Before F, both orderings exist (both-assumed-alive hypothetical).
    expect(beforeF.hypotheticalEstateTax!.spouseFirst).toBeDefined();
  });
});
