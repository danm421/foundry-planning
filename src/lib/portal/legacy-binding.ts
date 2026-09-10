// TEMPORARY — Deploy 1 only. Deleted in Task 15 alongside migration 0264.
//
// Reads the pre-0263 binding column so a client whose backfill row is somehow
// missing is not locked out during the dual-write window.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

export async function legacyPortalClientRef(
  clerkUserId: string,
): Promise<{ id: string; firmId: string | null; advisorId: string } | null> {
  const rows = await db
    .select({ id: clients.id, firmId: clients.firmId, advisorId: clients.advisorId })
    .from(clients)
    .where(eq(clients.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0] ?? null;
}
