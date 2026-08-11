import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import { isPortalFeatureEnabled } from "@/lib/portal/load-features";
import { PortalFeatureOffNotice } from "@/components/portal/feature-off-notice";
import { PortalInvestmentsScreen } from "@/components/portal/portal-investments-screen";

export const dynamic = "force-dynamic";

export default async function PortalInvestmentsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  // Advisor switched this section off — it is absent from the navs too, so the
  // only way here is a bookmark or a typed URL. Say so rather than 404.
  if (!(await isPortalFeatureEnabled(clientId, "investments"))) {
    return <PortalFeatureOffNotice feature="investments" viewer="client" />;
  }
  return <PortalInvestmentsScreen clientId={clientId} />;
}
