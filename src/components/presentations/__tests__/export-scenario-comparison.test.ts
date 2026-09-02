import { describe, it, expect } from "vitest";
import {
  planScenarioBundles, MAX_MC_SCENARIOS, keyForRef, resolveScenarioRef,
} from "@/lib/scenario/presentation-refs";
import { plannerFlagsFor } from "@/lib/presentations/export-page-sets";
import { PRESENTATION_PAGES } from "../registry";

describe("scenario comparison export planning", () => {
  it("admits base plus three scenarios under the Monte Carlo cap", () => {
    expect(MAX_MC_SCENARIOS).toBeGreaterThanOrEqual(4);
  });

  // The two registrations this task adds. Neither shows up as an error when it
  // is missing: a page absent from MONTE_CARLO_PAGE_IDS renders its Monte Carlo
  // figures as null (view-model.ts:127) and one absent from
  // SCENARIO_CHANGES_PAGE_IDS renders no change lines (view-model.ts:79) — both
  // silently blank on a client-facing sheet.
  it("is registered for a Monte Carlo run AND a scenario-changes load", () => {
    expect(plannerFlagsFor("scenarioComparison")).toEqual({
      needsMonteCarloRun: true,
      isScenarioChanges: true,
    });
  });

  it("flags a Monte Carlo run on EVERY ref the page declares", () => {
    const page = PRESENTATION_PAGES.scenarioComparison;
    const refs = page.requiredScenarioRefs!({
      ...page.defaultOptions, scenarioIds: ["s1", "s2", "s3"],
    });
    const plan = planScenarioBundles(
      // Flags DERIVED from production, not hardcoded — this is the same
      // PlannerPage the export route builds (render-presentation-pdf.ts), so
      // dropping the page from either set reddens the assertions below.
      [{
        supportsScenarioOverride: page.supportsScenarioOverride,
        scenarioOverride: undefined,
        ...plannerFlagsFor("scenarioComparison"),
        requiredRefs: refs,
      }],
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
