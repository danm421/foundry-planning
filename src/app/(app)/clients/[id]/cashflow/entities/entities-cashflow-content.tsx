import { db } from "@/db";
import { clients, entities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import EntitiesCashFlowReportView from "@/components/entities-cashflow-report-view";

interface Props {
  id: string;
  firmId: string;
}

export async function EntitiesCashFlowContent({ id, firmId }: Props) {
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
