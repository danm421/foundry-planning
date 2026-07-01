import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import EstateTransferTabbedView from "@/components/estate-transfer-tabbed-view";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";
import { hasSpouseForEstate } from "@/lib/estate/spousal-household";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function EstateTransferReportPage({ params, searchParams }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    notFound();
  }

  // CRM contacts — sole identity source.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact?.dateOfBirth) notFound();

  const clientFirstName = primaryContact.firstName;
  const clientDob = primaryContact.dateOfBirth;
  const spouseFirstName = spouseContact?.firstName ?? null;
  const spouseDob = spouseContact?.dateOfBirth ?? null;

  // Gate the second-death column on spouse existence, matching the engine's
  // second-death signal — NOT filing status. See hasSpouseForEstate.
  const isMarried = hasSpouseForEstate(spouseDob);

  const ownerNames = {
    clientName: clientFirstName ?? "Client",
    spouseName: spouseFirstName ?? null,
  };

  const ownerDobs = {
    clientDob,
    spouseDob: spouseDob ?? null,
  };

  const clientBirthYear = parseInt(clientDob.slice(0, 4), 10);
  const clientRetirementYear = clientBirthYear + client.retirementAge;
  const spouseRetirementYear =
    spouseDob && client.spouseRetirementAge != null
      ? parseInt(spouseDob.slice(0, 4), 10) + client.spouseRetirementAge
      : null;
  // "Retirement (Clients)" milestone = the year both have retired (later of the two).
  const retirementYear =
    spouseRetirementYear != null
      ? Math.max(clientRetirementYear, spouseRetirementYear)
      : clientRetirementYear;

  return (
    <ScenarioDrawerShell clientId={id} scenarioId={sp.scenario}>
      <EstateTransferTabbedView
        clientId={id}
        isMarried={isMarried}
        ownerNames={ownerNames}
        ownerDobs={ownerDobs}
        retirementYear={retirementYear}
      />
    </ScenarioDrawerShell>
  );
}
