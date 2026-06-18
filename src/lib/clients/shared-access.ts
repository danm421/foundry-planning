import { db } from "@/db";
import { clientShares, clients, crmHouseholds } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export type SharePermission = "view" | "edit";

/** Most-permissive collapse: edit beats view. */
export function effectivePermission(a: SharePermission, b: SharePermission): SharePermission {
  return a === "edit" || b === "edit" ? "edit" : "view";
}

export type ShareDetail = {
  clientId: string;
  ownerUserId: string;
  firmId: string;
  permission: SharePermission;
  scope: "all" | "client";
};

// Lower-level: every effective (clientId -> detail) for the recipient, with
// most-permissive collapse applied. The gate fast-path and the UI list both
// derive from this so there is a single expansion query.
async function buildShareMap(userId: string): Promise<Map<string, ShareDetail>> {
  const rows = await db
    .select()
    .from(clientShares)
    .where(and(eq(clientShares.recipientUserId, userId), isNull(clientShares.revokedAt)));

  const map = new Map<string, ShareDetail>();
  const add = (d: ShareDetail) => {
    const prev = map.get(d.clientId);
    map.set(
      d.clientId,
      prev ? { ...prev, permission: effectivePermission(prev.permission, d.permission) } : d,
    );
  };

  for (const r of rows) {
    if (r.scope === "client") {
      if (!r.clientId) continue;
      add({ clientId: r.clientId, ownerUserId: r.ownerUserId, firmId: r.firmId, permission: r.permission, scope: "client" });
    } else {
      // Expand share-all: the owner's non-private, non-soft-deleted book.
      const expanded = await db
        .select({ id: clients.id })
        .from(clients)
        .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
        .where(
          and(
            eq(clients.advisorId, r.ownerUserId),
            eq(clients.firmId, r.firmId),
            eq(clients.isPrivate, false),
            isNull(crmHouseholds.deletedAt),
          ),
        );
      for (const c of expanded) {
        add({ clientId: c.id, ownerUserId: r.ownerUserId, firmId: r.firmId, permission: r.permission, scope: "all" });
      }
    }
  }
  return map;
}

/** Gate-facing fast path: which client ids are shared to me, and at what level. */
export async function resolveSharedClientAccess(userId: string): Promise<{
  sharedClientIds: Set<string>;
  permissionByClientId: Map<string, SharePermission>;
}> {
  const map = await buildShareMap(userId);
  const sharedClientIds = new Set(map.keys());
  const permissionByClientId = new Map<string, SharePermission>();
  for (const [id, d] of map) permissionByClientId.set(id, d.permission);
  return { sharedClientIds, permissionByClientId };
}

/** UI-facing: full detail (owner + firm) per effective shared client. */
export async function resolveSharesForRecipient(userId: string): Promise<ShareDetail[]> {
  return [...(await buildShareMap(userId)).values()];
}
