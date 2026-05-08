import { db } from "@/db";
import { clients, entities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import EntitiesCashFlowReportView from "@/components/entities-cashflow-report-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EntitiesCashFlowReportPage({ params }: PageProps) {
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

  const entityRows = await db
    .select()
    .from(entities)
    .where(eq(entities.clientId, id));

  const entityInfos = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType,
  }));

  return (
    <EntitiesCashFlowReportView
      clientId={id}
      entities={entityInfos}
    />
  );
}
