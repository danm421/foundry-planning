import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios as scenariosTable, scenarioSnapshots } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { PresentationsLauncher } from "./launcher";

export default async function PresentationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: clientId } = await params;
  const firmId = await requireOrgId();
  await findClientInFirm(clientId, firmId);

  const [scenarioRows, snapshotRows] = await Promise.all([
    db
      .select({
        id: scenariosTable.id,
        name: scenariosTable.name,
        isBaseCase: scenariosTable.isBaseCase,
      })
      .from(scenariosTable)
      .where(eq(scenariosTable.clientId, clientId)),
    db
      .select({
        id: scenarioSnapshots.id,
        name: scenarioSnapshots.name,
        sourceKind: scenarioSnapshots.sourceKind,
      })
      .from(scenarioSnapshots)
      .where(eq(scenarioSnapshots.clientId, clientId)),
  ]);

  return (
    <PresentationsLauncher
      clientId={clientId}
      scenarios={scenarioRows}
      snapshots={snapshotRows}
    />
  );
}
