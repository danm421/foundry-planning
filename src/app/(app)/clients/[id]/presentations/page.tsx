import { and, eq, inArray } from "drizzle-orm";
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
import { loadProposalPickerOptions } from "@/lib/presentations/investment-proposal-bundle";
import { loadLiabilityPickerOptions } from "@/lib/presentations/liability-picker-options";
import { PresentationsLauncher } from "./launcher";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";
import { loadBrandPicker } from "@/lib/branding/brand-options";
import { householdBrand, normalizeBrand } from "@/lib/branding/brand-choice";
import { requireClientPageAccess } from "@/lib/clients/page-access";
import { householdAgePeople } from "@/lib/year-or-age";
import { birthYearFromDob } from "@/lib/age-year";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

export default async function PresentationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { id: clientId } = await params;
  await requireClientPageAccess(clientId);
  const sp = await searchParams;
  const firmId = await requireOrgId();
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();

  // Firm-scope gate + the household id we need for the primary contact's last
  // name (drives the auto filename in the launcher) + the advisor/brand that
  // seed the launcher's Brand default.
  const [clientRow] = await db
    .select({
      id: clients.id,
      crmHouseholdId: clients.crmHouseholdId,
      advisorId: clients.advisorId,
      brand: clients.brand,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)))
    .limit(1);
  if (!clientRow) notFound();

  const [scenarioRows, snapshotRows, templates, investmentCatalog, peopleRows, entityPickerOptions, dismissedSlugs, proposalOptions, liabilityOptions, brandPicker] = await Promise.all([
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
      .select({
        role: crmHouseholdContacts.role,
        firstName: crmHouseholdContacts.firstName,
        lastName: crmHouseholdContacts.lastName,
        dateOfBirth: crmHouseholdContacts.dateOfBirth,
      })
      .from(crmHouseholdContacts)
      .where(
        and(
          eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId),
          inArray(crmHouseholdContacts.role, ["primary", "spouse"]),
        ),
      ),
    loadEntityPickerOptions(clientId, firmId),
    listDismissedSlugs(firmId, userId),
    loadProposalPickerOptions(clientId),
    loadLiabilityPickerOptions(clientId),
    loadBrandPicker(firmId),
  ]);

  const primary = peopleRows.find((r) => r.role === "primary");
  const spouse = peopleRows.find((r) => r.role === "spouse");
  const clientLastName = primary?.lastName ?? "";
  // Year fields in page options take an age and show both ages beside the year.
  const agePeople = householdAgePeople(
    {
      clientBirthYear: birthYearFromDob(primary?.dateOfBirth) ?? undefined,
      spouseBirthYear: birthYearFromDob(spouse?.dateOfBirth) ?? undefined,
    },
    { client: primary?.firstName || "Client", spouse: spouse?.firstName || CO_CLIENT_LABEL },
  );
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
        proposals={proposalOptions}
        liabilities={liabilityOptions}
        agePeople={agePeople}
        brand={{
          picker: brandPicker,
          defaultValue: normalizeBrand(householdBrand(clientRow), brandPicker.allBrands),
        }}
      />
    </ScenarioDrawerShell>
  );
}
