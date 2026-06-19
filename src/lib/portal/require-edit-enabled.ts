import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { ForbiddenError } from "@/lib/authz";

/**
 * Throws ForbiddenError if the client's portal_edit_enabled is false.
 * Called by every portal mutation handler. Defense-in-depth — the UI
 * also hides edit controls when the toggle is off.
 */
export async function requireEditEnabled(clientId: string): Promise<void> {
  const [row] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!row || !row.portalEditEnabled) {
    throw new ForbiddenError("Portal editing disabled by advisor");
  }
}
