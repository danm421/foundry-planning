import { Suspense } from "react";
import { db } from "@/db";
import { clients } from "@/db/schema";
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
      firstName: clients.firstName,
      spouseName: clients.spouseName,
    })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const scenarioId = sp.scenario ?? "base";

  return (
    <Suspense fallback={<EstateFlowSkeleton />}>
      <EstateFlowContent
        clientId={id}
        firmId={firmId}
        filingStatus={client.filingStatus}
        firstName={client.firstName}
        spouseName={client.spouseName}
        scenarioId={scenarioId}
      />
    </Suspense>
  );
}
