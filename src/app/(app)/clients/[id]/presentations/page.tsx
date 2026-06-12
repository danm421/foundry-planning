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
import { listDismissedSlugs } from "@/lib/presentations/builtin-templates-repo";
import { partitionBuiltInRows } from "@/lib/presentations/builtin-templates";
import { listInvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import { loadEntityPickerOptions } from "@/lib/presentations/entity-picker-options";
import { PresentationsLauncher } from "./launcher";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

export default async function PresentationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { id: clientId } = await params;
  const sp = await searchParams;
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

  const [scenarioRows, snapshotRows, templates, investmentCatalog, primaryContactRows, entityPickerOptions, dismissedSlugs] = await Promise.all([
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
    loadEntityPickerOptions(clientId, firmId),
    listDismissedSlugs(firmId, userId),
  ]);

  const clientLastName = primaryContactRows[0]?.lastName ?? "";
  const { builtIn, builtInHidden } = partitionBuiltInRows(dismissedSlugs);

  return (
    <ScenarioDrawerShell clientId={clientId} scenarioId={sp.scenario}>
      <PresentationsLauncher
        clientId={clientId}
        currentUserId={userId}
        clientLastName={clientLastName}
        householdId={clientRow.crmHouseholdId}
        scenarios={scenarioRows}
        snapshots={snapshotRows}
        initialTemplates={{ ...templates, builtIn, builtInHidden }}
        investmentCatalog={investmentCatalog}
        entities={entityPickerOptions}
      />
    </ScenarioDrawerShell>
  );
}
