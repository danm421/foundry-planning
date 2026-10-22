// src/app/api/integrations/[provider]/connections/[connectionId]/_owned.ts
import { auth } from "@clerk/nextjs/server";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import type { IntegrationConnectionRow } from "@/lib/integrations/connections";
import type { SyncingProviderDefinition } from "@/lib/integrations/types";
import { resolveProvider } from "../../_provider";

/**
 * Resolves the `[provider]/connections/[connectionId]` segments to the
 * caller's own connection. Every way it can fail returns null, and the route
 * answers 404 for all of them alike: an unknown, disabled or non-syncing
 * provider, no session, a connection that isn't the caller's (a colleague's,
 * another firm's, or none), or one that belongs to another provider than the
 * URL names. So a connection id can't be probed.
 */
export async function resolveOwnedConnection(
  params: Promise<{ provider: string; connectionId: string }>,
): Promise<{
  provider: SyncingProviderDefinition;
  connection: IntegrationConnectionRow;
  firmId: string;
  userId: string;
} | null> {
  const provider = await resolveProvider(params);
  if (!provider || !provider.syncs) return null;

  const { userId, orgId: firmId } = await auth();
  if (!userId || !firmId) return null;

  const { connectionId } = await params;
  const connection = await getOwnedConnection({ connectionId, firmId, userId });
  if (!connection || connection.providerId !== provider.id) return null;
  return { provider, connection, firmId, userId };
}
