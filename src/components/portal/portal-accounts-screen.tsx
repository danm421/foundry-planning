import type { ReactElement } from "react";
import { loadAccountsPage } from "@/lib/portal/load-accounts-page";
import { AccountsWorkspace } from "@/components/portal/accounts-workspace";

export async function PortalAccountsScreen({
  clientId,
}: {
  clientId: string;
}): Promise<ReactElement> {
  const dto = await loadAccountsPage(clientId);
  return <AccountsWorkspace dto={dto} />;
}
