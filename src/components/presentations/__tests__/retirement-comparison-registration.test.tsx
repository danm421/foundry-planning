import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

describe("retirementComparison registration", () => {
  const page = PRESENTATION_PAGES.retirementComparison;

  it("defaults to the Base Case baseline, preserving today's behaviour", () => {
    expect(page.requiredScenarioRefs!(page.defaultOptions)).toEqual(["base"]);
    expect(page.requiredScenarioRefs!({ ...page.defaultOptions, scenarioId: "s9" })).toEqual(["base", "s9"]);
  });

  it("asks for the chosen baseline instead of always asking for base", () => {
    const o = { ...page.defaultOptions, baselineScenarioId: "s1", scenarioId: "s9" };
    expect(page.requiredScenarioRefs!(o)).toEqual(["s1", "s9"]);
  });

  it("exposes the baseline id to the launcher row", () => {
    expect(page.readBaselineScenarioId!(page.defaultOptions)).toBe("base");
    expect(page.readBaselineScenarioId!({ ...page.defaultOptions, baselineScenarioId: "s1" })).toBe("s1");
  });
});
