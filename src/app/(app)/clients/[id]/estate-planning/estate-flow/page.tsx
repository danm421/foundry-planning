import { Suspense } from "react";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { EstateFlowContent } from "./estate-flow-content";
import EstateFlowSkeleton from "./loading-skeleton";

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
      legacyFirstName: clients.firstName,
      legacySpouseName: clients.spouseName,
      crmHouseholdId: clients.crmHouseholdId,
    })
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

  const scenarioId = sp.scenario ?? "base";

  return (
    <Suspense fallback={<EstateFlowSkeleton />}>
      <EstateFlowContent
        clientId={id}
        firmId={firmId}
        filingStatus={client.filingStatus}
        firstName={primaryContact?.firstName ?? client.legacyFirstName}
        spouseName={spouseContact?.firstName ?? client.legacySpouseName}
        scenarioId={scenarioId}
      />
    </Suspense>
  );
}
