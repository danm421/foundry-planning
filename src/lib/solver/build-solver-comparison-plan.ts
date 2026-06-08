// Adapter that wraps the solver's (id, label, tree, years) pair in a
// ComparisonPlan-shaped object so it can be fed to useSharedMcRun without
// pulling in the full async build pipeline from build-comparison-plans.ts.
// The MC hook only reads `id`, `label`, `tree`, and `result.years` — the
// rest of the fields are stubbed and shouldn't be relied on by other widgets.

import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { ScenarioRef } from "@/lib/scenario/loader";

export interface BuildSolverComparisonPlanArgs {
  id: string;
  label: string;
  tree: ClientData;
  years: ProjectionYear[];
  isBaseline: boolean;
  index: number;
}

export function buildSolverComparisonPlan(
  args: BuildSolverComparisonPlanArgs,
): ComparisonPlan {
  // Solver plans wrap transient in-memory trees — the live base facts and the
  // working tree being edited — neither of which is a saved scenario. They must
  // be snapshot refs: useSharedMcRun's cacheScenarioId() returns null for
  // snapshots, so it runs Monte Carlo client-side on `tree` instead of fetching
  // `/api/clients/[id]/monte-carlo?scenario=<id>`. A scenario ref here would
  // send the transient id (e.g. "working:v1"), which loadEffectiveTree rejects
  // with "Scenario not found" → 500 → the PoS gauge shows "Error".
  const ref: ScenarioRef = {
    kind: "snapshot",
    id: args.id,
    side: args.isBaseline ? "left" : "right",
  };

  return {
    index: args.index,
    isBaseline: args.isBaseline,
    ref,
    id: args.id,
    label: args.label,
    tree: args.tree,
    result: { years: args.years } as ComparisonPlan["result"],
    lifetime: {
      total: 0,
      byBucket: {
        regularFederalIncomeTax: 0,
        capitalGainsTax: 0,
        amtAdditional: 0,
        niit: 0,
        additionalMedicare: 0,
        fica: 0,
        stateTax: 0,
      },
    },
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}
