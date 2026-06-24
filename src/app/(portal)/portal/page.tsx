import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import PortalDashboard from "@/components/portal/portal-dashboard";

export default async function PortalIndex(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <PortalDashboard clientId={clientId} />;
}
