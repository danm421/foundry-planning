import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { scenarios as scenariosTable, scenarioSnapshots } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { listTemplatesForUser } from "@/lib/presentations/templates-repo";
import { listInvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import { PresentationsLauncher } from "./launcher";

export default async function PresentationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: clientId } = await params;
  const firmId = await requireOrgId();
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();
  await findClientInFirm(clientId, firmId);

  const [scenarioRows, snapshotRows, templates, investmentCatalog] = await Promise.all([
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
    listTemplatesForUser(firmId, userId),
    listInvestmentOptionCatalog(clientId, firmId),
  ]);

  return (
    <PresentationsLauncher
      clientId={clientId}
      currentUserId={userId}
      scenarios={scenarioRows}
      snapshots={snapshotRows}
      initialTemplates={templates}
      investmentCatalog={investmentCatalog}
    />
  );
}
