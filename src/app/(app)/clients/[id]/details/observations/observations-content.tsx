import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, planObservations } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import ObservationsPanel, { type ObservationItem } from "@/components/observations/observations-panel";

interface ObservationsContentProps {
  clientId: string;
}

export async function ObservationsContent({ clientId: id }: ObservationsContentProps) {
  const firmId = await getOrgId();

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const rows = await db
    .select()
    .from(planObservations)
    .where(eq(planObservations.clientId, id))
    .orderBy(
      asc(planObservations.section),
      asc(planObservations.sortOrder),
      asc(planObservations.createdAt),
    );

  const initialItems: ObservationItem[] = rows.map((r) => ({
    id: r.id,
    section: r.section,
    topic: r.topic,
    title: r.title,
    body: r.body,
    status: r.status,
    owner: r.owner,
    priority: r.priority,
    targetDate: r.targetDate,
    source: r.source,
    sortOrder: r.sortOrder,
  }));

  return <ObservationsPanel clientId={id} initialItems={initialItems} />;
}
