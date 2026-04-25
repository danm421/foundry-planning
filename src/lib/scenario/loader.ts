// src/lib/scenario/loader.ts
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { loadClientData } from "@/lib/projection/load-client-data";
import type { ClientData } from "@/engine/types";
import {
  applyScenarioChanges,
} from "@/engine/scenario/applyChanges";
import type {
  CascadeWarning,
  ToggleState,
} from "@/engine/scenario/types";
import { loadScenarioChanges, loadScenarioToggleGroups } from "./changes";

export interface LoadEffectiveTreeResult {
  effectiveTree: ClientData;
  warnings: CascadeWarning[];
}

export const loadEffectiveTree = cache(
  async (
    clientId: string,
    firmId: string,
    scenarioId: string | "base",
    toggleState: ToggleState,
  ): Promise<LoadEffectiveTreeResult> => {
    const baseTree = await loadClientData(clientId, firmId);

    let resolvedScenario;
    if (scenarioId === "base") {
      const [s] = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
      if (!s) throw new Error(`Client ${clientId} has no base case scenario`);
      resolvedScenario = s;
    } else {
      const [s] = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)));
      if (!s) throw new Error(`Scenario ${scenarioId} not found for client ${clientId}`);
      resolvedScenario = s;
    }

    // Fast path: when scenarioId resolves to the client's base case AND no
    // toggles are explicitly set, we can return baseTree directly.
    if (resolvedScenario.isBaseCase && Object.keys(toggleState).length === 0) {
      return { effectiveTree: baseTree, warnings: [] };
    }

    const [changes, groups] = await Promise.all([
      loadScenarioChanges(resolvedScenario.id),
      loadScenarioToggleGroups(resolvedScenario.id),
    ]);

    return applyScenarioChanges(baseTree, changes, toggleState, groups);
  },
);
