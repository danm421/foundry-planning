import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { countDistinct, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, plaidItems } from "@/db/schema";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import { getConnection } from "@/lib/integrations/connections";
import { listProviders } from "@/lib/integrations/registry";
import { IntegrationConnectionCard } from "@/components/IntegrationConnectionCard";
import { IntegrationHouseholdLinkTable } from "@/components/IntegrationHouseholdLinkTable";
import { PlaidIntegrationTile } from "@/components/PlaidIntegrationTile";
import Forbidden from "../forbidden";

export default async function IntegrationsPage(): Promise<ReactElement> {
  try {
    await requireOrgAdminOrOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden requiredRole="admin or owner" />;
    throw err;
  }

  const { orgId: firmId } = await auth();
  if (!firmId) return <Forbidden requiredRole="admin or owner" />;

  const providers = listProviders();
  const connections = await Promise.all(
    providers.map(async (p) => ({ provider: p, conn: await getConnection(firmId, p.id) })),
  );

  const [plaidCounts] = await db
    .select({
      clientCount: countDistinct(plaidItems.clientId),
      institutionCount: countDistinct(plaidItems.institutionId),
    })
    .from(plaidItems)
    .innerJoin(clients, eq(clients.id, plaidItems.clientId))
    .where(eq(clients.firmId, firmId));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Integrations</h1>
        <p className="text-sm text-ink-3">
          Connect custodians and data providers to sync accounts and holdings into Foundry.
        </p>
      </header>

      {connections.map(({ provider, conn }) => {
        const connected = !!conn && conn.status !== "disconnected";
        return (
          <div key={provider.id} className="flex flex-col gap-4">
            <IntegrationConnectionCard
              providerId={provider.id}
              label={provider.label}
              enabled={provider.isEnabled()}
              authKind={provider.authKind}
              status={conn?.status ?? "disconnected"}
              lastSyncedAt={conn?.lastSyncedAt ? conn.lastSyncedAt.toISOString() : null}
              lastSyncError={conn?.lastSyncError ?? null}
            />
            {connected ? <IntegrationHouseholdLinkTable providerId={provider.id} /> : null}
          </div>
        );
      })}

      <PlaidIntegrationTile
        clientCount={plaidCounts?.clientCount ?? 0}
        institutionCount={plaidCounts?.institutionCount ?? 0}
      />
    </div>
  );
}
