import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { countDistinct, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, plaidItems } from "@/db/schema";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import { getConnection } from "@/lib/integrations/connections";
import { listProviders } from "@/lib/integrations/registry";
import type { SyncingProviderDefinition } from "@/lib/integrations/types";
import { IntegrationConnectionCard } from "@/components/IntegrationConnectionCard";
import { IntegrationHouseholdLinkTable } from "@/components/IntegrationHouseholdLinkTable";
import { PlaidIntegrationTile } from "@/components/PlaidIntegrationTile";
import { AzureOpenAiCard } from "@/components/AzureOpenAiCard";
import { decodeAzureConfig } from "@/lib/ai/credentials";
import { isAzureOpenAiEnabled } from "@/lib/integrations/providers/azure-openai/flag";
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

  // Azure OpenAI is credentials-only — it gets its own card below, not the
  // sync card + household table the custodial providers share.
  const providers = listProviders().filter(
    (p): p is SyncingProviderDefinition => p.syncs,
  );
  const connections = await Promise.all(
    providers.map(async (p) => ({ provider: p, conn: await getConnection(firmId, p.id) })),
  );

  // Azure OpenAI is credentials-only. Read its connection separately and render
  // its own card — never the sync card, and never the household table.
  const azureConn = isAzureOpenAiEnabled() ? await getConnection(firmId, "azure_openai") : null;
  let azureView: { endpoint: string; chatDeployment: string } | null = null;
  if (azureConn?.scope) {
    try {
      const cfg = decodeAzureConfig(azureConn.scope);
      azureView = { endpoint: cfg.endpoint, chatDeployment: cfg.chatDeployment };
    } catch {
      // A corrupt config must not blank the whole settings page.
      azureView = null;
    }
  }

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
          Connect custodians and data providers to sync accounts and holdings into Foundry Planning.
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

      {isAzureOpenAiEnabled() ? (
        <AzureOpenAiCard
          status={azureConn?.status ?? "disconnected"}
          endpoint={azureView?.endpoint ?? null}
          chatDeployment={azureView?.chatDeployment ?? null}
          connectedAt={azureConn?.connectedAt ? azureConn.connectedAt.toISOString() : null}
        />
      ) : null}
    </div>
  );
}
