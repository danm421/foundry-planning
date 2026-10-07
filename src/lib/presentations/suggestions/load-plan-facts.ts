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
import { runProjectionWithEvents, type ProjectionResult } from "@/engine/projection";
import { loadEffectiveTreeForRef } from "@/lib/scenario/loader";
import { resolveScenarioRef } from "@/lib/scenario/presentation-refs";
import { withoutTestOrphans } from "@/lib/scenario/test-orphans";
import { loadProposalPickerOptions } from "@/lib/presentations/investment-proposal-bundle";
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
      addsRothConversion: mine.some((c) => c.targetKind === "roth_conversion" && c.opType === "add"),
    };
  });
}

export async function loadPlanFacts(
  clientId: string,
  firmId: string,
  planRef: string,
  today: Date = new Date(),
): Promise<PlanFacts> {
  const [{ effectiveTree: tree }, scenarios, proposals, holdingRows, observationRows, storyRows] =
    await Promise.all([
      loadEffectiveTreeForRef(clientId, firmId, resolveScenarioRef(planRef)),
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

  // A plan the engine can't project still has ages, accounts and debts worth
  // matching on — suggest from those rather than fail the panel.
  let projection: ProjectionResult | null = null;
  try {
    projection = runProjectionWithEvents(tree);
  } catch (err) {
    console.error("report suggestions: projection failed", { clientId, planRef, err });
  }

  return buildPlanFacts({
    tree,
    projection,
    today,
    extras: {
      planRef,
      scenarios,
      proposals: proposals.map((p) => ({ id: p.id, name: p.name })),
      hasHoldings: holdingRows.length > 0,
      observationCount: Number(observationRows[0]?.n ?? 0),
      storyChapterCount: Number(storyRows[0]?.n ?? 0),
    },
  });
}
