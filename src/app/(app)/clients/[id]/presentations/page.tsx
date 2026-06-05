import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  clients,
  crmHouseholdContacts,
  scenarios as scenariosTable,
  scenarioSnapshots,
} from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
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

  // Firm-scope gate + the household id we need for the primary contact's last
  // name (drives the auto filename in the launcher).
  const [clientRow] = await db
    .select({ id: clients.id, crmHouseholdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)))
    .limit(1);
  if (!clientRow) notFound();

  const [scenarioRows, snapshotRows, templates, investmentCatalog, primaryContactRows] = await Promise.all([
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
    db
      .select({ lastName: crmHouseholdContacts.lastName })
      .from(crmHouseholdContacts)
      .where(
        and(
          eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId),
          eq(crmHouseholdContacts.role, "primary"),
        ),
      )
      .limit(1),
  ]);

  const clientLastName = primaryContactRows[0]?.lastName ?? "";

  return (
    <PresentationsLauncher
      clientId={clientId}
      currentUserId={userId}
      clientLastName={clientLastName}
      scenarios={scenarioRows}
      snapshots={snapshotRows}
      initialTemplates={templates}
      investmentCatalog={investmentCatalog}
    />
  );
}
