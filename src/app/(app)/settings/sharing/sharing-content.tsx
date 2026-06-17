import "server-only";
import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientShares, clients, crmHouseholds } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { resolveSharesForRecipient } from "@/lib/clients/shared-access";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { resolveFirmNames } from "@/lib/activity/resolve-firm-names";
import { SharingPanels } from "./sharing-panels";

export type OutgoingShare = {
  id: string;
  recipientEmail: string;
  permission: "view" | "edit";
  scope: "all" | "client";
  /** Client household name — present when scope === "client". */
  clientName: string | null;
  clientId: string | null;
};

export type IncomingShare = {
  ownerUserId: string;
  ownerName: string;
  firmId: string;
  firmName: string;
  permission: "view" | "edit";
  /** Number of clients shared in from this owner. */
  clientCount: number;
};

export async function SharingContent(): Promise<ReactElement> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return (
      <p className="text-sm text-ink-3">Sign in to manage sharing.</p>
    );
  }

  // --- Outgoing shares ---
  // Non-revoked shares owned by this user (members see their own; page is
  // accessible to all org members, not just admins).
  const rawOutgoing = await db
    .select()
    .from(clientShares)
    .where(
      and(
        eq(clientShares.ownerUserId, userId),
        eq(clientShares.firmId, orgId),
        isNull(clientShares.revokedAt),
      ),
    );

  // Enrich per-client shares with the household name.
  const clientIds = rawOutgoing
    .filter((r) => r.scope === "client" && r.clientId)
    .map((r) => r.clientId as string);

  const clientNameMap = new Map<string, string>();
  if (clientIds.length > 0) {
    const rows = await db
      .select({ id: clients.id, name: crmHouseholds.name })
      .from(clients)
      .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
      .where(and(eq(clients.firmId, orgId), inArray(clients.id, clientIds)));
    for (const r of rows) clientNameMap.set(r.id, r.name);
  }

  const outgoing: OutgoingShare[] = rawOutgoing.map((r) => ({
    id: r.id,
    recipientEmail: r.recipientEmail,
    permission: r.permission,
    scope: r.scope,
    clientId: r.clientId ?? null,
    clientName: r.clientId ? (clientNameMap.get(r.clientId) ?? null) : null,
  }));

  // --- Incoming shares ---
  // resolveSharesForRecipient returns one ShareDetail per effective client.
  // Group by ownerUserId+firmId and count; then resolve owner names + firm names.
  const rawIncoming = await resolveSharesForRecipient(userId);

  // Aggregate: one entry per (ownerUserId, firmId) — take most-permissive permission.
  type AggKey = string; // `${ownerUserId}|${firmId}`
  const aggMap = new Map<
    AggKey,
    { ownerUserId: string; firmId: string; permission: "view" | "edit"; count: number }
  >();
  for (const d of rawIncoming) {
    const key: AggKey = `${d.ownerUserId}|${d.firmId}`;
    const prev = aggMap.get(key);
    if (prev) {
      prev.count += 1;
      if (d.permission === "edit") prev.permission = "edit";
    } else {
      aggMap.set(key, {
        ownerUserId: d.ownerUserId,
        firmId: d.firmId,
        permission: d.permission,
        count: 1,
      });
    }
  }

  const entries = Array.from(aggMap.values());

  // Resolve owner display names and firm names concurrently.
  const ownerIds = [...new Set(entries.map((e) => e.ownerUserId))];
  const firmIds = [...new Set(entries.map((e) => e.firmId))];
  const [actorMap, firmNames] = await Promise.all([
    resolveActors(ownerIds),
    resolveFirmNames(firmIds),
  ]);
  const ownerNames = new Map(
    [...actorMap.entries()].map(([id, a]) => [id, a.name]),
  );

  const incoming: IncomingShare[] = entries.map((e) => ({
    ownerUserId: e.ownerUserId,
    ownerName: ownerNames.get(e.ownerUserId) ?? "Unknown user",
    firmId: e.firmId,
    firmName: firmNames.get(e.firmId) ?? "Unknown firm",
    permission: e.permission,
    clientCount: e.count,
  }));

  return <SharingPanels outgoing={outgoing} incoming={incoming} />;
}
