// Adapter that wraps the solver's (id, label, tree, years) into the minimal
// SharedMcPlan shape consumed by useSharedMcRun, without pulling in any
// projection/comparison build pipeline.

import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ScenarioRef } from "@/lib/scenario/loader";
import type { SharedMcPlan } from "@/hooks/use-shared-mc-run";

export interface BuildSolverComparisonPlanArgs {
  id: string;
  label: string;
  tree: ClientData;
  years: ProjectionYear[];
  isBaseline: boolean;
}

export function buildSolverComparisonPlan(
  args: BuildSolverComparisonPlanArgs,
): SharedMcPlan {
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
    ref,
    id: args.id,
    label: args.label,
    tree: args.tree,
    result: { years: args.years },
  };
}
