import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyClientAccessAs, type Principal } from "@/lib/clients/authz";

/**
 * Resolve the base-case scenario id for a client after verifying firm + staff
 * access (`principal`'s when passed, else the session's). Mirrors the route's
 * private `getBaseCaseScenarioId` (POST route) —
 * returns null when the client is inaccessible OR has no base case, which the
 * cores map to a 404 "Client not found" exactly like the route.
 *
 * Shared by the expense / income / liability / account write-cores (it was
 * cloned byte-for-byte across all four before this extraction). Keep the
 * "inaccessible OR no base case → null → 404" contract intact: callers depend
 * on the single null sentinel to reproduce the route's behavior.
 */
export async function baseCaseScenarioId(clientId: string, firmId: string, principal?: Principal): Promise<string | null> {
  const a = await verifyClientAccessAs(principal, clientId);
  if (!a.ok || a.firmId !== firmId) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}
