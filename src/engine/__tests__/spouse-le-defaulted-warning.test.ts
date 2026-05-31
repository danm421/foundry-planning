import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildMinimalEstateScenario } from "./_fixtures/estate";
import type { ClientData } from "@/engine/types";

/**
 * F17: when a spouse DOB is present but spouseLifeExpectancy is null, the
 * engine silently assumes the spouse lives to age 95 (`?? 95`). projection.ts
 * must surface a `"spouse_life_expectancy_defaulted"` warning, emitted exactly
 * once, on the first-death year's deathWarnings.
 */
describe("F17 spouse_life_expectancy_defaulted warning (projection wiring)", () => {
  const WARNING = "spouse_life_expectancy_defaulted";

  /** Year of the first death event (client dies in 2030 in this fixture). */
  function firstDeathYear(data: ClientData) {
    const years = runProjection(data);
    return years.find((y) => y.estateTax?.deathOrder === 1);
  }

  it("emits the warning when spouseDob is set but spouseLifeExpectancy is null", () => {
    const data = buildMinimalEstateScenario({ priorClient: 0 });
    // Null the spouse LE while keeping spouseDob — triggers the age-95 default.
    data.client.spouseLifeExpectancy = null as unknown as number;

    const fd = firstDeathYear(data);
    expect(fd).toBeDefined();
    expect(fd!.deathWarnings).toContain(WARNING);

    // Emitted exactly once across the whole projection.
    const occurrences = runProjection(data)
      .flatMap((y) => y.deathWarnings ?? [])
      .filter((w) => w === WARNING);
    expect(occurrences).toHaveLength(1);
  });

  it("does NOT emit the warning when spouseLifeExpectancy is provided", () => {
    // Fixture already sets spouseLifeExpectancy: 95 explicitly.
    const data = buildMinimalEstateScenario({ priorClient: 0 });
    expect(data.client.spouseLifeExpectancy).toBe(95);

    const allWarnings = runProjection(data).flatMap((y) => y.deathWarnings ?? []);
    expect(allWarnings).not.toContain(WARNING);
  });
});
