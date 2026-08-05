import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import OrganizerCashFlowScreen from "@/components/portal/organizer-cash-flow-screen";

export default async function OrganizerCashFlowPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <OrganizerCashFlowScreen clientId={clientId} />;
}
