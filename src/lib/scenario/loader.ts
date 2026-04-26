// src/lib/scenario/loader.ts
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, scenarioSnapshots, scenarios } from "@/db/schema";
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

/**
 * Discriminated union identifying which "tree" to load for a client. Either
 * (a) a live scenario id (or "base") with a ToggleState — recomputed from
 * base + changes via `loadEffectiveTree`, or (b) a frozen snapshot ref —
 * returned verbatim from `scenario_snapshots.effective_tree_{left,right}`.
 */
export type ScenarioRef =
  | { kind: "scenario"; id: string | "base"; toggleState: ToggleState }
  | { kind: "snapshot"; id: string; side: "left" | "right" };

/**
 * Sibling of `loadEffectiveTree` that also accepts a snapshot ref. Snapshot
 * reads short-circuit to frozen JSON — no recompute, zero cascade warnings.
 *
 * Firm scoping: snapshots inherit firmId via the parent client (the table
 * has no firmId column). The snapshot path enforces it explicitly via an
 * inner-join on `clients` and an additional `clientId` equality check, so a
 * cross-firm snapshot id passed in by mistake throws rather than leaking.
 */
export async function loadEffectiveTreeForRef(
  clientId: string,
  firmId: string,
  ref: ScenarioRef,
): Promise<LoadEffectiveTreeResult> {
  if (ref.kind === "snapshot") {
    const [snap] = await db
      .select({
        effectiveTreeLeft: scenarioSnapshots.effectiveTreeLeft,
        effectiveTreeRight: scenarioSnapshots.effectiveTreeRight,
      })
      .from(scenarioSnapshots)
      .innerJoin(clients, eq(clients.id, scenarioSnapshots.clientId))
      .where(
        and(
          eq(scenarioSnapshots.id, ref.id),
          eq(scenarioSnapshots.clientId, clientId),
          eq(clients.firmId, firmId),
        ),
      );
    if (!snap) {
      throw new Error(`Snapshot ${ref.id} not found for client ${clientId}`);
    }

    const tree =
      ref.side === "left"
        ? (snap.effectiveTreeLeft as ClientData)
        : (snap.effectiveTreeRight as ClientData);
    return { effectiveTree: tree, warnings: [] };
  }

  return loadEffectiveTree(clientId, firmId, ref.id, ref.toggleState);
}
