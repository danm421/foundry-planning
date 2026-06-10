import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { ForbiddenError } from "@/lib/authz";
import { resolveVisibleAdvisorIds, VISIBLE_ALL } from "@/lib/visibility";
import { STAFF_ROLES } from "@/lib/capabilities";

// Shared staff-scope check: firm-wide roles always pass; staff roles pass only
// when the advisor is in their mapped set. The single home for "can this caller
// see this advisor's client".
async function staffMaySeeAdvisor(
  advisorId: string,
  firmId: string,
): Promise<boolean> {
  const { userId, orgRole } = await auth();
  if (!orgRole || !STAFF_ROLES.has(orgRole)) return true;
  if (!userId) return false;
  const visible = await resolveVisibleAdvisorIds(userId, orgRole, firmId);
  return visible !== VISIBLE_ALL && visible.has(advisorId);
}

/**
 * Boolean gate, signature-compatible with the inline `verifyClientAccess`
 * helpers it replaces across the `[id]` API routes. firm scope + staff scope.
 */
export async function verifyClientAccess(
  clientId: string,
  firmId: string,
): Promise<boolean> {
  const [client] = await db
    .select({ advisorId: clients.advisorId })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return false;
  return staffMaySeeAdvisor(client.advisorId, firmId);
}

/**
 * Throw-based gate that also returns the row + firmId, for callers (e.g.
 * `ClientLayout`, the `[id]` detail route) that need the client object. Throws
 * a single ForbiddenError for both not-found and access-denied so existence
 * never leaks across firms / advisor books.
 */
export async function requireClientAccess(
  clientId: string,
): Promise<{ client: typeof clients.$inferSelect; firmId: string }> {
  const firmId = await requireOrgId();
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client || !(await staffMaySeeAdvisor(client.advisorId, firmId))) {
    throw new ForbiddenError("Client not found or access denied");
  }
  return { client, firmId };
}
