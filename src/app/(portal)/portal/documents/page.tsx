import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import { toPortalFeatures } from "@/lib/portal/features";
import { portalFeatureColumns } from "@/lib/portal/load-features";
import { PortalDocumentsScreen } from "@/components/portal/portal-documents-screen";

export default async function DocumentsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  // Same edit gate every other portal section uses — the /api/portal/* routes
  // are act-as aware, so advisor "preview as client" edits exactly when client
  // editing is on. Downloads and navigation stay available regardless.
  const [client] = await db
    .select({
      portalEditEnabled: clients.portalEditEnabled,
      ...portalFeatureColumns,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  // Advisor switched this section off — it is absent from the navs too. Read
  // off the row above rather than via `isPortalFeatureEnabled` like the
  // Investments and Budget gates: this page already queries the client.
  if (!toPortalFeatures(client).documents) notFound();
  const editEnabled = client?.portalEditEnabled ?? false;

  return <PortalDocumentsScreen editEnabled={editEnabled} />;
}
