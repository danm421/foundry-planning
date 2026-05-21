import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import YearlyLiquidityReportView from "@/components/yearly-liquidity-report-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EstateLiquidityPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  // CRM contacts — identity source.
  const contactRows = client.crmHouseholdId
    ? await db
        .select()
        .from(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId))
    : [];
  const primaryContact = contactRows.find((c) => c.role === "primary") ?? null;
  const spouseContact = contactRows.find((c) => c.role === "spouse") ?? null;

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

  const ownerNames = {
    clientName: primaryContact?.firstName ?? client.firstName ?? "Client",
    spouseName: spouseContact?.firstName ?? client.spouseName ?? null,
  };

  const ownerDobs = {
    clientDob: primaryContact?.dateOfBirth ?? client.dateOfBirth,
    spouseDob: spouseContact?.dateOfBirth ?? client.spouseDob ?? null,
  };

  return (
    <YearlyLiquidityReportView
      clientId={id}
      isMarried={isMarried}
      ownerNames={ownerNames}
      ownerDobs={ownerDobs}
    />
  );
}
