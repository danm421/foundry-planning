import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

/**
 * Resolve the Foundry `clients.id` for a Clerk user that is bound to the
 * portal. Returns null for any user that isn't a portal user (no row in
 * `clients` with `clerk_user_id = $1`).
 *
 * Wrapped in React.cache so middleware + layouts + route handlers in the
 * same request only hit the DB once.
 */
export const getPortalClientId = cache(async (
  clerkUserId: string,
): Promise<string | null> => {
  if (!clerkUserId) return null;
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0]?.id ?? null;
});
