// src/lib/scenario/load-projection-for-ref.ts
//
// Shared helper: load a ClientData tree for a ScenarioRef (or the estate-
// planning "do-nothing" counterfactual) and run the projection engine over it.
//
// Extracted from estate-planning/page.tsx so the upcoming scenario-comparison
// page can reuse it without duplicating the logic.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios as scenariosTable, scenarioSnapshots } from "@/db/schema";
import {
  loadEffectiveTreeForRef,
  type ScenarioRef,
} from "@/lib/scenario/loader";
import type { EstateCompareRef } from "@/lib/scenario/scenario-from-search-params";
import { runProjectionWithEvents } from "@/engine";
import type { ProjectionResult } from "@/engine/projection";
import type { ClientData } from "@/engine/types";
import { synthesizeNoPlanClientData } from "@/lib/estate/counterfactual";

export interface LoadedProjection {
  tree: ClientData;
  result: ProjectionResult;
  scenarioName: string;
  isDoNothing: boolean;
}

async function resolveScenarioName(ref: ScenarioRef): Promise<string> {
  if (ref.kind === "snapshot") {
    const [row] = await db
      .select({ name: scenarioSnapshots.name })
      .from(scenarioSnapshots)
      .where(eq(scenarioSnapshots.id, ref.id));
    return row?.name ?? "Snapshot";
  }
  if (ref.id === "base") return "Base case";
  const [row] = await db
    .select({ name: scenariosTable.name })
    .from(scenariosTable)
    .where(eq(scenariosTable.id, ref.id));
  return row?.name ?? "Scenario";
}

export async function loadProjectionForRef(
  clientId: string,
  firmId: string,
  ref: EstateCompareRef,
): Promise<LoadedProjection> {
  if (ref.kind === "do-nothing") {
    // Need a real tree to feed `synthesizeNoPlanClientData`. Use the base case.
    const baseRef: ScenarioRef = { kind: "scenario", id: "base", toggleState: {} };
    const { effectiveTree } = await loadEffectiveTreeForRef(clientId, firmId, baseRef);
    const counterfactual = synthesizeNoPlanClientData(effectiveTree);
    return {
      tree: counterfactual,
      result: runProjectionWithEvents(counterfactual),
      scenarioName: "Do nothing (no plan)",
      isDoNothing: true,
    };
  }

  const { effectiveTree } = await loadEffectiveTreeForRef(clientId, firmId, ref);
  const result = runProjectionWithEvents(effectiveTree);
  return {
    tree: effectiveTree,
    result,
    scenarioName: await resolveScenarioName(ref),
    isDoNothing: false,
  };
}
