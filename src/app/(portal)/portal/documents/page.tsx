import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import { PortalDocumentsScreen } from "@/components/portal/portal-documents-screen";

export default async function DocumentsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <PortalDocumentsScreen clientId={clientId} />;
}
