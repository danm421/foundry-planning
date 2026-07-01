import { Suspense } from "react";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { EstateFlowContent } from "./estate-flow-content";
import EstateFlowSkeleton from "./loading-skeleton";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

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
      crmHouseholdId: clients.crmHouseholdId,
    })
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
  if (!primaryContact) notFound();

  const scenarioId = sp.scenario ?? "base";

  return (
    <ScenarioDrawerShell clientId={id} scenarioId={sp.scenario}>
      <Suspense fallback={<EstateFlowSkeleton />}>
        <EstateFlowContent
          clientId={id}
          firmId={firmId}
          firstName={primaryContact.firstName}
          spouseName={spouseContact?.firstName ?? null}
          scenarioId={scenarioId}
        />
      </Suspense>
    </ScenarioDrawerShell>
  );
}
