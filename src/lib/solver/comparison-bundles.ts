// src/lib/solver/comparison-bundles.ts
import { keyForRef, resolveScenarioRef } from "@/lib/scenario/presentation-refs";
import type { PageScenarioBundle } from "@/components/presentations/document";

/** Synthetic scenario id for the solver working tree (Base Case + live edits).
 *  The comparison builders resolve the scenario bundle via
 *  keyForRef(resolveScenarioRef(options.scenarioId)); registering the working
 *  bundle under the matching key and passing this id keeps the two in lockstep. */
export const WORKING_SCENARIO_ID = "working";

/** Assemble the `bundlesByRef` map the comparison builders read: Base Case under
 *  "base", the working tree under "scenario:working". Single source of truth for
 *  the synthetic-id contract. */
export function comparisonBundlesByRef(
  base: PageScenarioBundle,
  working: PageScenarioBundle,
): Record<string, PageScenarioBundle> {
  return {
    [keyForRef(resolveScenarioRef("base"))]: base,
    [keyForRef(resolveScenarioRef(WORKING_SCENARIO_ID))]: working,
  };
}
