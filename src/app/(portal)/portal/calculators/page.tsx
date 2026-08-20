import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import { isPortalFeatureEnabled } from "@/lib/portal/load-features";
import { PortalFeatureOffNotice } from "@/components/portal/feature-off-notice";
import { CalculatorsScreen } from "@/components/portal/calculators-screen";

export const dynamic = "force-dynamic";

export default async function PortalCalculatorsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  if (!(await isPortalFeatureEnabled(clientId, "calculators"))) {
    return <PortalFeatureOffNotice feature="calculators" viewer="client" />;
  }
  return <CalculatorsScreen />;
}
