import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import { PortalAccountsScreen } from "@/components/portal/portal-accounts-screen";

export default async function OrganizerAccountsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <PortalAccountsScreen clientId={clientId} />;
}
