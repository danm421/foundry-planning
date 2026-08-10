import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

/**
 * Resolve the portal binding for a Clerk user: the Foundry `clients.id` plus
 * the owning `firm_id`. Returns null for any user that isn't a portal user (no
 * row in `clients` with `clerk_user_id = $1`).
 *
 * `firmId` rides along because every portal gate needs it — the portal user has
 * no `orgId` of their own, so the advisor firm's subscription and entitlements
 * are what authorize them. Selecting it here keeps that a single query rather
 * than a second lookup per gate.
 *
 * Wrapped in React.cache so middleware + layouts + route handlers in the
 * same request only hit the DB once.
 */
export const getPortalClientRef = cache(async (
  clerkUserId: string,
): Promise<{ id: string; firmId: string | null } | null> => {
  if (!clerkUserId) return null;
  const rows = await db
    .select({ id: clients.id, firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0] ?? null;
});

/** The bound `clients.id` alone. Shares `getPortalClientRef`'s cached query. */
export async function getPortalClientId(clerkUserId: string): Promise<string | null> {
  return (await getPortalClientRef(clerkUserId))?.id ?? null;
}
