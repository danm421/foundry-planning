// src/lib/scenario/loader.ts
import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, entityFlowOverrides, scenarioSnapshots, scenarios } from "@/db/schema";
import { loadClientDataWithContext } from "@/lib/projection/load-client-data";
import {
  resolveAccountFromRaw,
  resolveIncomeFromRaw,
  resolveExpenseFromRaw,
  resolveSavingsRuleFromRaw,
  type ResolutionContext,
} from "@/lib/projection/resolve-entity";
import type { ClientData, EntityFlowOverride } from "@/engine/types";
import {
  applyScenarioChanges,
} from "@/engine/scenario/applyChanges";
import type {
  CascadeWarning,
  ScenarioChange,
  ToggleGroup,
  ToggleState,
} from "@/engine/scenario/types";
import { resolveRefYears } from "@/lib/year-refs";
import { loadScenarioChanges, loadScenarioToggleGroups } from "./changes";

/**
 * Walks an `add` change's raw payload through the matching resolver so the
 * engine receives a fully-resolved entity (numeric growthRate, realization,
 * category-specific overrides) instead of the raw form payload that the
 * scenario writer persists. Mirrors `loadClientData`'s base path.
 *
 * Other targetKinds (entity, will, etc.) and edit/remove ops fall through
 * unchanged — `applyScenarioChanges` handles their coercion.
 */
export function resolveAddPayload(
  change: ScenarioChange,
  ctx: ResolutionContext,
): ScenarioChange {
  if (change.opType !== "add") return change;
  const raw = change.payload as Record<string, unknown>;
  switch (change.targetKind) {
    case "account":
      return { ...change, payload: resolveAccountFromRaw(raw as never, ctx) };
    case "income":
      return { ...change, payload: resolveIncomeFromRaw(raw as never, ctx) };
    case "expense":
      return { ...change, payload: resolveExpenseFromRaw(raw as never, ctx) };
    case "savings_rule":
      return { ...change, payload: resolveSavingsRuleFromRaw(raw as never, ctx) };
    default:
      return change;
  }
}

export interface LoadEffectiveTreeResult {
  effectiveTree: ClientData;
  warnings: CascadeWarning[];
}

/**
 * Applies scenario changes, then reshifts every milestone-anchored
 * `startYear`/`endYear` via `resolveRefYears`.
 *
 * A scenario change can move a household milestone — retirement age, plan end
 * age, date of birth. The engine reads only the concrete `startYear`/`endYear`
 * on each income/expense/savings row, treating `*YearRef` as view metadata,
 * so a milestone move must be propagated to every dependent year window
 * before projection. The live solver already does this in `applyMutations`;
 * the persisted-scenario reload path has to do the same — otherwise a saved
 * "retire at 67" scenario reloads with stale age-65 windows and projects
 * identically to base.
 */
export function applyScenarioChangesWithRefs(
  treeForChanges: ClientData,
  changes: ScenarioChange[],
  toggleState: ToggleState,
  groups: ToggleGroup[],
): LoadEffectiveTreeResult {
  const { effectiveTree, warnings } = applyScenarioChanges(
    treeForChanges,
    changes,
    toggleState,
    groups,
  );
  return { effectiveTree: resolveRefYears(effectiveTree), warnings };
}

export const loadEffectiveTree = cache(
  async (
    clientId: string,
    firmId: string,
    scenarioId: string | "base",
    toggleState: ToggleState,
  ): Promise<LoadEffectiveTreeResult> => {
    const { clientData: baseTree, resolutionContext } =
      await loadClientDataWithContext(clientId, firmId);

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
    // toggles are explicitly set, we can return baseTree directly. The base
    // tree already carries the base (scenario_id IS NULL) flow overrides.
    if (resolvedScenario.isBaseCase && Object.keys(toggleState).length === 0) {
      return { effectiveTree: baseTree, warnings: [] };
    }

    const entityIds = baseTree.entities?.map((e) => e.id) ?? [];
    const [changes, groups, scenarioFlowOverrideRows] = await Promise.all([
      loadScenarioChanges(resolvedScenario.id),
      loadScenarioToggleGroups(resolvedScenario.id),
      // Per-entity scenario flow overrides. Empty entity list → skip the
      // query (Postgres rejects `IN ()`).
      resolvedScenario.isBaseCase || entityIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              entityId: entityFlowOverrides.entityId,
              year: entityFlowOverrides.year,
              incomeAmount: entityFlowOverrides.incomeAmount,
              expenseAmount: entityFlowOverrides.expenseAmount,
              distributionPercent: entityFlowOverrides.distributionPercent,
            })
            .from(entityFlowOverrides)
            .where(
              and(
                inArray(entityFlowOverrides.entityId, entityIds),
                eq(entityFlowOverrides.scenarioId, resolvedScenario.id),
              ),
            ),
    ]);

    // Per-entity inheritance: the writer at PUT
    // /api/clients/[id]/entities/[entityId]/flow-overrides?scenarioId=…
    // replaces flow overrides for a single (entity, scenario) pair, so the
    // natural granularity for inheritance is also per-entity. For each entity:
    //   • scenario has any rows → use ONLY the scenario's rows for that entity
    //   • scenario has no rows  → inherit the base entity's rows
    // This way a fresh non-base scenario (no scenario-scoped rows yet) is
    // exactly equivalent to base for entity flows, instead of silently
    // zeroing them out.
    const scenarioEntityIdsWithOverrides = new Set(
      scenarioFlowOverrideRows.map((r) => r.entityId),
    );
    const inheritedBaseRows = (baseTree.entityFlowOverrides ?? []).filter(
      (r) => !scenarioEntityIdsWithOverrides.has(r.entityId),
    );
    const treeForChanges: ClientData = resolvedScenario.isBaseCase
      ? baseTree
      : {
          ...baseTree,
          entityFlowOverrides: [
            ...inheritedBaseRows,
            ...scenarioFlowOverrideRows.map(
              (r): EntityFlowOverride => ({
                entityId: r.entityId,
                year: r.year,
                incomeAmount: r.incomeAmount != null ? parseFloat(r.incomeAmount) : null,
                expenseAmount: r.expenseAmount != null ? parseFloat(r.expenseAmount) : null,
                distributionPercent:
                  r.distributionPercent != null ? parseFloat(r.distributionPercent) : null,
              }),
            ),
          ],
        };

    const resolvedChanges = changes.map((c) => resolveAddPayload(c, resolutionContext));

    return applyScenarioChangesWithRefs(
      treeForChanges,
      resolvedChanges,
      toggleState,
      groups,
    );
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
