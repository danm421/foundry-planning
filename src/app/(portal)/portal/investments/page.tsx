import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import { PortalInvestmentsScreen } from "@/components/portal/portal-investments-screen";

export const dynamic = "force-dynamic";

export default async function PortalInvestmentsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <PortalInvestmentsScreen clientId={clientId} />;
}
