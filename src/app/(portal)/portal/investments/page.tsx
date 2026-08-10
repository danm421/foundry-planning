import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { requireClientPortalAccess } from "@/lib/authz";
import { isPortalFeatureEnabled } from "@/lib/portal/load-features";
import { PortalInvestmentsScreen } from "@/components/portal/portal-investments-screen";

export const dynamic = "force-dynamic";

export default async function PortalInvestmentsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  // Advisor switched this section off — it is absent from the navs too, so a
  // stale link or a typed URL lands on the portal's not-found, not an empty page.
  if (!(await isPortalFeatureEnabled(clientId, "investments"))) notFound();
  return <PortalInvestmentsScreen clientId={clientId} />;
}
