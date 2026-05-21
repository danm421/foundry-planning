import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import EstateTaxTabbedView from "@/components/estate-tax-tabbed-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EstateTaxReportPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    // Parent layout already handles the 404 case via notFound(); this is a
    // belt-and-suspenders fallback if scope ever drifts.
    notFound();
  }

  // CRM contacts — identity source.
  const contactRows = client.crmHouseholdId
    ? await db
        .select()
        .from(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId))
    : [];
  const primaryContact = contactRows.find((c) => c.role === "primary") ?? null;
  const spouseContact = contactRows.find((c) => c.role === "spouse") ?? null;

  const clientFirstName = primaryContact?.firstName ?? client.firstName;
  const clientDob = primaryContact?.dateOfBirth ?? client.dateOfBirth;
  const spouseFirstName = spouseContact?.firstName ?? client.spouseName;
  const spouseDob = spouseContact?.dateOfBirth ?? client.spouseDob;

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

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
    <EstateTaxTabbedView
      clientId={id}
      isMarried={isMarried}
      ownerNames={ownerNames}
      ownerDobs={ownerDobs}
      retirementYear={retirementYear}
    />
  );
}
