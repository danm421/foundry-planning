import { clerkClient } from "@clerk/nextjs/server";

/**
 * Best-effort resolution of a Clerk user ID to a display name, snapshotted into
 * `audit_log.metadata.actorName` at write time so a row keeps its author's name
 * even after that user leaves the org (Clerk stops returning departed members).
 *
 * Guarantees for the caller (`recordAudit`):
 *  - Never throws — any Clerk failure resolves to null so the audit insert
 *    still happens. (Tests that mock only `auth()` leave `clerkClient`
 *    undefined; that TypeError is swallowed here.)
 *  - Cheap under bulk writes — a module-level TTL cache dedupes lookups across
 *    calls and (Fluid Compute) reused instances, so intake/import loops hit
 *    Clerk once per unique user, not once per row.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const nameCache = new Map<string, { name: string; at: number }>();

export function _resetActorNameCache(): void {
  nameCache.clear();
}

export async function snapshotActorName(
  actorId: string,
  now: number = Date.now(),
): Promise<string | null> {
  if (!actorId.startsWith("user_")) return null;

  const hit = nameCache.get(actorId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.name;

  try {
    const cc = await clerkClient();
    const user = await cc.users.getUser(actorId);
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.emailAddresses?.[0]?.emailAddress ||
      "";
    if (!name) return null;
    nameCache.set(actorId, { name, at: now });
    return name;
  } catch {
    // Best-effort: Clerk unreachable / mocked-away / user gone. The read path
    // still resolves current members live; the snapshot only backfills names.
    return null;
  }
}
