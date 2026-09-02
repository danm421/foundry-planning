import { describe, it, expect } from "vitest";
import {
  planScenarioBundles, MAX_MC_SCENARIOS, keyForRef, resolveScenarioRef,
} from "@/lib/scenario/presentation-refs";
import { PRESENTATION_PAGES } from "../registry";

describe("scenario comparison export planning", () => {
  it("admits base plus three scenarios under the Monte Carlo cap", () => {
    expect(MAX_MC_SCENARIOS).toBeGreaterThanOrEqual(4);
  });

  it("flags a Monte Carlo run on EVERY ref the page declares", () => {
    const page = PRESENTATION_PAGES.scenarioComparison;
    const refs = page.requiredScenarioRefs!({
      ...page.defaultOptions, scenarioIds: ["s1", "s2", "s3"],
    });
    const plan = planScenarioBundles(
      [{ supportsScenarioOverride: false, scenarioOverride: undefined,
         needsMonteCarloRun: true, isScenarioChanges: true, requiredRefs: refs }],
      "base",
    );
    expect(plan.distinct.size).toBe(4);
    for (const d of plan.distinct.values()) expect(d.needsMonteCarlo).toBe(true);
    // Base has no stored change set; the three live scenarios do.
    expect(plan.distinct.get("base")!.needsScenarioChanges).toBe(false);
    expect(plan.distinct.get(keyForRef(resolveScenarioRef("s1")))!.needsScenarioChanges)
      .toBe(true);
  });
});
