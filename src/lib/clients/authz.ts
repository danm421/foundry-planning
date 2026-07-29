import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { UnauthorizedError } from "@/lib/db-helpers";
import { ForbiddenError } from "@/lib/authz";
import { resolveVisibleAdvisorIds, VISIBLE_ALL } from "@/lib/visibility";
import { resolveSharedClientAccess, type SharePermission } from "./shared-access";

// Can the current caller see this advisor's client? Admin/owner → always.
// Staff → their mapped set. Advisor (org:member) in a siloed firm → only their
// own advisorId (share-based access is resolved separately by the caller).
// The single home for "can this caller see this advisor's client".
async function callerMaySeeAdvisor(
  advisorId: string,
  firmId: string,
): Promise<boolean> {
  const { userId, orgRole } = await auth();
  if (!userId) return false;
  const visible = await resolveVisibleAdvisorIds(userId, orgRole, firmId);
  if (visible === VISIBLE_ALL) return true;
  return visible.has(advisorId);
}

export type ClientAccessCheck =
  | { ok: false }
  | { ok: true; permission: SharePermission; firmId: string; access: "own" | "shared" };

/**
 * Non-throwing client access check. Own-firm access depends on ownership,
 * admin/owner role, or (siloed firms) mapped staff visibility; a denied
 * own-firm caller still falls through to the cross-org share resolver, since
 * an intra-firm per-client share can grant access a siloed book would
 * otherwise deny. Read handlers gate on `ok`; mutation handlers additionally
 * require `permission === "edit"`.
 */
export async function verifyClientAccess(clientId: string): Promise<ClientAccessCheck> {
  const { userId, orgId } = await auth();
  if (!userId) return { ok: false };

  const [client] = await db
    .select({ advisorId: clients.advisorId, firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!client) return { ok: false };

  if (orgId && client.firmId === orgId) {
    if (await callerMaySeeAdvisor(client.advisorId, client.firmId)) {
      return { ok: true, permission: "edit", firmId: client.firmId, access: "own" };
    }
    // fall through to share resolution (an intra-firm per-client share may grant access)
  }

  const { sharedClientIds, permissionByClientId } = await resolveSharedClientAccess(userId);
  if (sharedClientIds.has(clientId)) {
    return { ok: true, permission: permissionByClientId.get(clientId) ?? "view", firmId: client.firmId, access: "shared" };
  }
  return { ok: false };
}

export type ClientAccess = {
  client: typeof clients.$inferSelect;
  firmId: string;
  permission: SharePermission;
  access: "own" | "shared";
};

/**
 * Throw-based gate that also returns the row + firmId + permission + access,
 * for callers (e.g. `ClientLayout`, the `[id]` detail route) that need the
 * client object. Throws a single ForbiddenError for both not-found and
 * access-denied so existence never leaks across firms / advisor books.
 *
 * Cross-org callers get access via `clientShares`; own-firm callers pass when
 * they own the client, hold an admin/owner role, or (siloed firms) are mapped
 * staff, and always receive `permission: "edit"`. A denied own-firm caller
 * falls through to the share resolver below rather than throwing immediately,
 * since an intra-firm per-client share can still grant access.
 */
export async function requireClientAccess(clientId: string): Promise<ClientAccess> {
  const { userId, orgId } = await auth();
  if (!userId) throw new UnauthorizedError();

  // Load by id ONLY — cross-tenant grants mean we cannot pre-filter by firm.
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw new ForbiddenError("Client not found or access denied");

  // Own-firm path: ownership/admin/silo rules, full edit.
  if (orgId && client.firmId === orgId) {
    if (await callerMaySeeAdvisor(client.advisorId, client.firmId)) {
      return { client, firmId: client.firmId, permission: "edit", access: "own" };
    }
    // fall through to share resolution (an intra-firm per-client share may grant access)
  }

  // Cross-firm path: consult the share resolver.
  const { sharedClientIds, permissionByClientId } = await resolveSharedClientAccess(userId);
  if (sharedClientIds.has(clientId)) {
    return {
      client,
      firmId: client.firmId,
      permission: permissionByClientId.get(clientId) ?? "view",
      access: "shared",
    };
  }
  throw new ForbiddenError("Client not found or access denied");
}

/**
 * Throw-based write gate: wraps `requireClientAccess` and additionally
 * rejects callers that only hold a view-level share. Returns the client
 * row, the owning firmId, and the access type ("own" | "shared").
 * The single home for the cross-org WRITE rule.
 */
export async function requireClientEditAccess(clientId: string) {
  const acc = await requireClientAccess(clientId);
  if (acc.permission !== "edit") {
    throw new ForbiddenError("Edit access required");
  }
  return { client: acc.client, firmId: acc.firmId, access: acc.access };
}
