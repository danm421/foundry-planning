import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import type { ClientAccess } from "@/lib/clients/authz";
import { getHouseholdLinkForClient } from "./households";
import { listOwnedConnections } from "./connections";
import { getProvider } from "./registry";
import type { ProviderId, SyncingProviderId } from "./types";

/** Props for `IntegrationClientStatus` — the Net Worth page's sync row. */
export interface ClientIntegrationStatus {
  providerId: ProviderId;
  providerLabel: string;
  canEdit: boolean;
  linked: boolean;
  /** ISO string (serialized across the server boundary) or null. */
  lastSyncedAt: string | null;
  /** The viewer's own usable connections — what an unlinked client can be linked through. */
  connections: Array<{
    id: string;
    providerId: SyncingProviderId;
    providerLabel: string;
    name: string;
  }>;
}

/**
 * The syncing integration to show for one client, or null when there is none:
 * the provider the client is linked to, else — for an own-firm caller only —
 * the provider of the viewer's own connections, so the client can be linked
 * through one of them.
 */
export async function loadClientIntegrationStatus(
  clientId: string,
  userId: string,
  access: Pick<ClientAccess, "firmId" | "access">,
): Promise<ClientIntegrationStatus | null> {
  const [link, owned] = await Promise.all([
    getHouseholdLinkForClient(clientId),
    listOwnedConnections({ firmId: access.firmId, userId }),
  ]);
  // Same filter the cron uses: connected, kill-switch on, and a provider that
  // actually pulls households (azure_openai never offers a link).
  const connections = owned.flatMap((c) => {
    const def = getProvider(c.providerId);
    if (c.status !== "connected" || !def.isEnabled() || !def.syncs) return [];
    return [{ id: c.id, providerId: c.providerId, providerLabel: def.label, name: c.name ?? def.label }];
  });
  // Own-firm callers only: `permission === "edit"` alone also covers an
  // edit-level SHARE, and every integration route 403s anything that isn't
  // `access === "own"` — so gating on permission would hand the unlinked
  // affordance to a caller whose click always fails. The linked path is
  // unaffected: it already renders for a shared caller off `link` alone.
  const canEdit = access.access === "own";
  const provider = link
    ? getProvider(link.provider)
    : canEdit && connections.length > 0
      ? getProvider(connections[0].providerId)
      : null;
  if (!provider?.syncs) return null;

  let lastSyncedAt: Date | null = null;
  if (link) {
    const [recent] = await db
      .select({ last: accounts.lastSyncedAt })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.externalProvider, link.provider), isNotNull(accounts.lastSyncedAt)))
      .orderBy(desc(accounts.lastSyncedAt))
      .limit(1);
    lastSyncedAt = recent?.last ?? null;
  }

  return {
    providerId: provider.id,
    providerLabel: provider.label,
    canEdit,
    linked: !!link,
    connections,
    lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
  };
}
