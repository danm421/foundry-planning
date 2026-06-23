import type { ReactElement } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, entities } from "@/db/schema";
import ProfileTrustsList from "@/components/portal/profile-trusts-list";

interface Props {
  clientId: string;
}

export default async function TrustsSection({
  clientId,
}: Props): Promise<ReactElement> {
  const [client] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      entityType: entities.entityType,
      value: entities.value,
      isGrantor: entities.isGrantor,
    })
    .from(entities)
    .where(and(eq(entities.clientId, clientId), eq(entities.entityType, "trust")));

  const editEnabled = client?.portalEditEnabled ?? false;

  return (
    <div className="max-w-2xl p-5">
      <ProfileTrustsList rows={rows} editEnabled={editEnabled} />
    </div>
  );
}
