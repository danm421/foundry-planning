import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import type { ClientAccess } from "@/lib/clients/authz";
import { getHouseholdLinkForClient } from "./households";
import { getConnectedSyncingProviderId } from "./connections";
import { getProvider } from "./registry";
import type { ProviderId } from "./types";

/** Props for `IntegrationClientStatus` — the Net Worth page's sync row. */
export interface ClientIntegrationStatus {
  providerId: ProviderId;
  providerLabel: string;
  canEdit: boolean;
  linked: boolean;
  /** ISO string (serialized across the server boundary) or null. */
  lastSyncedAt: string | null;
}

/**
 * The syncing integration to show for one client, or null when there is none:
 * the provider the client is linked to, else — for an own-firm caller only —
 * the firm's connected syncing provider, so the client can be linked.
 */
export async function loadClientIntegrationStatus(
  clientId: string,
  access: Pick<ClientAccess, "firmId" | "access">,
): Promise<ClientIntegrationStatus | null> {
  const [link, connectedProviderId] = await Promise.all([
    getHouseholdLinkForClient(clientId),
    getConnectedSyncingProviderId(access.firmId),
  ]);
  // Own-firm callers only: `permission === "edit"` alone also covers an
  // edit-level SHARE, and every integration route 403s anything that isn't
  // `access === "own"` — so gating on permission would hand the unlinked
  // affordance to a caller whose click always fails. The linked path is
  // unaffected: it already renders for a shared caller off `link` alone.
  const canEdit = access.access === "own";
  const provider = link
    ? getProvider(link.provider)
    : canEdit && connectedProviderId
      ? getProvider(connectedProviderId)
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
    lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
  };
}
