// Storage side of the report suggestions: load the chosen plan, project it,
// and gather the few counts the tree doesn't carry.
//
// Scoping: `loadEffectiveTreeForRef` proves clientId + firmId for the plan
// itself (it throws on an alien scenario or snapshot). Every other read here
// keys on that same clientId — or on scenario ids read for it — after the
// route's `verifyClientAccess`, as the export's own side reads do.
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accountHoldings,
  accounts,
  planObservations,
  planStoryChapters,
  scenarioChanges,
  scenarios as scenariosTable,
} from "@/db/schema";
import type { ClientData } from "@/engine/types";
import { runProjectionWithEvents, type ProjectionResult } from "@/engine/projection";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { loadEffectiveTreeForRef } from "@/lib/scenario/loader";
import { resolveScenarioRef } from "@/lib/scenario/presentation-refs";
import { withoutTestOrphans } from "@/lib/scenario/test-orphans";
import { loadProposalPickerOptions } from "@/lib/presentations/investment-proposal-bundle";
import { activeChanges } from "./scenario-facts";
import { buildPlanFacts, type PlanFacts, type ScenarioSummary } from "./plan-facts";

async function loadScenarioSummaries(clientId: string): Promise<ScenarioSummary[]> {
  const rows = await db
    .select({ id: scenariosTable.id, name: scenariosTable.name })
    .from(scenariosTable)
    .where(and(eq(scenariosTable.clientId, clientId), eq(scenariosTable.isBaseCase, false)));
  const live = withoutTestOrphans(rows);
  if (live.length === 0) return [];

  const changes = await db
    .select({
      scenarioId: scenarioChanges.scenarioId,
      targetKind: scenarioChanges.targetKind,
      opType: scenarioChanges.opType,
      n: count(),
    })
    .from(scenarioChanges)
    .where(and(inArray(scenarioChanges.scenarioId, live.map((s) => s.id)), eq(scenarioChanges.enabled, true)))
    .groupBy(scenarioChanges.scenarioId, scenarioChanges.targetKind, scenarioChanges.opType);

  return live.map((s) => {
    const mine = changes.filter((c) => c.scenarioId === s.id);
    return {
      id: s.id,
      name: s.name,
      changeCount: mine.reduce((sum, c) => sum + Number(c.n), 0),
      hasRothConversion: mine.some((c) => c.targetKind === "roth_conversion" && c.opType !== "remove"),
    };
  });
}

function project(tree: ClientData, clientId: string, planRef: string): ProjectionResult | null {
  // A plan the engine can't project still has ages, accounts and debts worth
  // matching on — suggest from those rather than fail the panel.
  try {
    return runProjectionWithEvents(tree);
  } catch (err) {
    console.error("report suggestions: projection failed", { clientId, planRef, err });
    return null;
  }
}

export async function loadPlanFacts(
  clientId: string,
  firmId: string,
  planRef: string,
  today: Date = new Date(),
): Promise<PlanFacts> {
  const ref = resolveScenarioRef(planRef);
  // A live scenario is weighed against Base Case: Base Case's tree beside it,
  // and the change rows it applies. `loadEffectiveTreeForRef(ref)` proves the
  // scenario is this client's (it throws on an alien id, failing the whole
  // Promise.all), so the change rows read beside it never reach a caller for
  // a scenario that isn't theirs.
  const scenarioId = ref.kind === "scenario" && ref.id !== "base" ? ref.id : null;
  const [
    { effectiveTree: tree },
    baseLoad,
    changeRows,
    toggleGroups,
    scenarios,
    proposals,
    holdingRows,
    observationRows,
    storyRows,
  ] = await Promise.all([
    loadEffectiveTreeForRef(clientId, firmId, ref),
    scenarioId ? loadEffectiveTreeForRef(clientId, firmId, resolveScenarioRef("base")) : null,
    scenarioId ? loadScenarioChanges(scenarioId) : [],
    scenarioId ? loadScenarioToggleGroups(scenarioId) : [],
    loadScenarioSummaries(clientId),
    loadProposalPickerOptions(clientId),
    db
      .select({ id: accountHoldings.id })
      .from(accountHoldings)
      .innerJoin(accounts, eq(accounts.id, accountHoldings.accountId))
      .where(eq(accounts.clientId, clientId))
      .limit(1),
    db
      .select({ n: count() })
      .from(planObservations)
      .where(and(eq(planObservations.clientId, clientId), eq(planObservations.audience, "client"))),
    db.select({ n: count() }).from(planStoryChapters).where(eq(planStoryChapters.clientId, clientId)),
  ]);

  return buildPlanFacts({
    tree,
    projection: project(tree, clientId, planRef),
    today,
    extras: {
      planRef,
      scenarios,
      proposals: proposals.map((p) => ({ id: p.id, name: p.name })),
      hasHoldings: holdingRows.length > 0,
      observationCount: Number(observationRows[0]?.n ?? 0),
      storyChapterCount: Number(storyRows[0]?.n ?? 0),
    },
    scenario:
      scenarioId && baseLoad
        ? {
            id: scenarioId,
            // A hidden test scenario is filtered out of the summaries.
            name: scenarios.find((s) => s.id === scenarioId)?.name ?? "Scenario",
            rows: activeChanges(changeRows, toggleGroups),
            baseTree: baseLoad.effectiveTree,
            baseProjection: project(baseLoad.effectiveTree, clientId, "base"),
          }
        : undefined,
  });
}
