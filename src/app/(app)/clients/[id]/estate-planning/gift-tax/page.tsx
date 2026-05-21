import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import GiftTaxReportView from "@/components/gift-tax-report-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function GiftTaxReportPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  // CRM contacts — sole identity source.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact?.dateOfBirth) notFound();

  return (
    <GiftTaxReportView
      clientId={id}
      ownerNames={{
        clientName: primaryContact.firstName,
        spouseName: spouseContact?.firstName ?? null,
      }}
      ownerDobs={{
        clientDob: primaryContact.dateOfBirth,
        spouseDob: spouseContact?.dateOfBirth ?? null,
      }}
    />
  );
}
