import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import AccountsSection from "@/components/portal/accounts-section";

export default async function AccountsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <AccountsSection clientId={clientId} />;
}
