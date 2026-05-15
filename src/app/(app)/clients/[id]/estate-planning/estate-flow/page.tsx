import { db } from "@/db";
import { clients, scenarios as scenariosTable, scenarioSnapshots } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import EstateFlowView from "@/components/estate-flow-view";
import type { SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function EstateFlowPage({ params, searchParams }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select({
      filingStatus: clients.filingStatus,
      firstName: clients.firstName,
      spouseName: clients.spouseName,
    })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const scenarioId = sp.scenario ?? "base";

  const [{ effectiveTree }, scenarioRows, snapshotRows] = await Promise.all([
    loadEffectiveTree(id, firmId, scenarioId, {}).catch(() => notFound()),
    db
      .select({
        id: scenariosTable.id,
        name: scenariosTable.name,
        isBaseCase: scenariosTable.isBaseCase,
      })
      .from(scenariosTable)
      .innerJoin(clients, eq(clients.id, scenariosTable.clientId))
      .where(and(eq(scenariosTable.clientId, id), eq(clients.firmId, firmId))),
    db
      .select({
        id: scenarioSnapshots.id,
        name: scenarioSnapshots.name,
        sourceKind: scenarioSnapshots.sourceKind,
      })
      .from(scenarioSnapshots)
      .innerJoin(clients, eq(clients.id, scenarioSnapshots.clientId))
      .where(and(eq(scenarioSnapshots.clientId, id), eq(clients.firmId, firmId))),
  ]);

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

  return (
    <EstateFlowView
      clientId={id}
      scenarioId={scenarioId}
      isMarried={isMarried}
      ownerNames={{
        clientName: client.firstName ?? "Client",
        spouseName: client.spouseName ?? null,
      }}
      initialClientData={effectiveTree}
      scenarios={scenarioRows}
      snapshots={snapshotRows as SnapshotOption[]}
    />
  );
}
