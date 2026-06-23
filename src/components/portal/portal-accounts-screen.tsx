import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import AccountsSection from "@/components/portal/accounts-section";
import { InstitutionsSection } from "@/components/portal/institutions-section";
import { LinkBankWidget } from "@/components/portal/link-bank-widget";

export async function PortalAccountsScreen({
  clientId,
}: {
  clientId: string;
}): Promise<ReactElement> {
  const [client] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const editEnabled = client?.portalEditEnabled ?? false;

  return (
    <>
      {editEnabled && <LinkBankWidget />}
      <InstitutionsSection clientId={clientId} editEnabled={editEnabled} />
      <AccountsSection clientId={clientId} />
    </>
  );
}
