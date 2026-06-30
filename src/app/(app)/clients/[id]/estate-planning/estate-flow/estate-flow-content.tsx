import { db } from "@/db";
import {
  clients,
  scenarios as scenariosTable,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { loadGiftDrafts } from "@/lib/estate/load-gift-drafts";
import EstateFlowView from "@/components/estate-flow-view";

interface Props {
  clientId: string;
  firmId: string;
  filingStatus: string;
  firstName: string | null;
  spouseName: string | null;
  scenarioId: string;
}

export async function EstateFlowContent({
  clientId,
  firmId,
  filingStatus,
  firstName,
  spouseName,
  scenarioId,
}: Props) {
  // gift_series is scenario-scoped, so resolve the concrete scenario UUID first.
  // Mirrors load-client-data.ts / loadEffectiveTree: "base" → the client's
  // base-case scenario row; otherwise the searchParams UUID, firm-scoped via
  // the join on clients. loadGiftDrafts does its own internal scenario lookup +
  // gift queries, so it runs in parallel here.
  //
  // The do-nothing baseline (left side of the Comparison tab) is loaded in
  // parallel since it always derives from the base case regardless of the
  // active scenario — see loadProjectionForRef.
  const [effectiveResult, scenarioRows, initialGifts, doNothingLoad] = await Promise.all([
    loadEffectiveTree(clientId, firmId, scenarioId, {}).catch(() => notFound()),
    db
      .select({
        id: scenariosTable.id,
        name: scenariosTable.name,
        isBaseCase: scenariosTable.isBaseCase,
      })
      .from(scenariosTable)
      .innerJoin(clients, eq(clients.id, scenariosTable.clientId))
      .where(and(eq(scenariosTable.clientId, clientId), eq(clients.firmId, firmId))),
    loadGiftDrafts(clientId, firmId, scenarioId),
    loadProjectionForRef(clientId, firmId, { kind: "do-nothing" }),
  ]);
  const { effectiveTree } = effectiveResult;

  const resolvedScenario =
    scenarioId === "base"
      ? scenarioRows.find((s) => s.isBaseCase)
      : scenarioRows.find((s) => s.id === scenarioId);
  if (!resolvedScenario) notFound();

  // Strip the loader's baked-in gifts — the view re-materialises from
  // workingGifts (single source of truth).
  const giftFreeTree = { ...effectiveTree, gifts: [], giftEvents: [] };

  // CPI for series fan-out. resolvedInflationRate is not exposed on ClientData
  // (it lives on the loader's ResolutionContext), so use the raw plan-settings
  // inflation rate — the only inflation field reachable on effectiveTree.
  const cpi = effectiveTree.planSettings.inflationRate;

  const isMarried =
    filingStatus === "married_joint" || filingStatus === "married_separate";

  return (
    <EstateFlowView
      key={scenarioId}
      clientId={clientId}
      scenarioId={scenarioId}
      scenarioName={resolvedScenario.name}
      isMarried={isMarried}
      ownerNames={{
        clientName: firstName ?? "Client",
        spouseName: spouseName ?? null,
      }}
      initialClientData={giftFreeTree}
      initialGifts={initialGifts}
      cpi={cpi}
      scenarios={scenarioRows}
      snapshots={[]}
      doNothingTree={doNothingLoad.tree}
      doNothingResult={doNothingLoad.result}
      doNothingScenarioName={doNothingLoad.scenarioName}
    />
  );
}
