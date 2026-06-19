import type { ReactElement } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, entities } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import ProfileTrustsList from "@/components/portal/profile-trusts-list";

export default async function TrustsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();

  const [{ portalEditEnabled }] = await db
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
    .where(
      and(
        eq(entities.clientId, clientId),
        eq(entities.entityType, "trust"),
      ),
    );

  return (
    <div className="p-5 max-w-2xl">
      <ProfileTrustsList rows={rows} editEnabled={portalEditEnabled} />
    </div>
  );
}
