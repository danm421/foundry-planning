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
import { prepareEstateFlowTree } from "@/lib/estate/estate-flow-tree";
import EstateFlowView from "@/components/estate-flow-view";

interface Props {
  clientId: string;
  firmId: string;
  firstName: string | null;
  spouseName: string | null;
  scenarioId: string;
}

export async function EstateFlowContent({
  clientId,
  firmId,
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

  const { giftFreeTree, cpi, isMarried } = prepareEstateFlowTree(effectiveTree);

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
