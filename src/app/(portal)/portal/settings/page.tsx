import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import { loadPortalPrivacy } from "@/lib/portal/privacy";
import { PortalSettingsView } from "@/components/portal/portal-settings-view";

export default async function PortalSettingsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  const [privacy, [client]] = await Promise.all([
    loadPortalPrivacy(clientId),
    db
      .select({ portalEditEnabled: clients.portalEditEnabled })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1),
  ]);
  return (
    <PortalSettingsView
      privacy={privacy}
      clientId={clientId}
      editEnabled={client?.portalEditEnabled ?? false}
    />
  );
}
