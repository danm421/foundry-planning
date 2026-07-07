import { clerkClient } from "@clerk/nextjs/server";
import {
  isClerkUserId,
  pickActor,
  type ActorDisplay,
} from "./actor-display";

export type { ActorDisplay } from "./actor-display";

/**
 * Resolve a flat list of actor IDs to display names (system/org labels, live
 * Clerk names, else "Former member"). Every input ID gets an entry. Used by
 * surfaces that only have an actor ID and no per-row metadata snapshot
 * (clients list, sharing, tasks, CRM). For the activity feed — where a
 * snapshotted name can rescue a departed member — use `hydrateRowActors`.
 */
export async function resolveActors(
  actorIds: string[],
): Promise<Map<string, ActorDisplay>> {
  const liveNames = await resolveActorNames(actorIds);
  const result = new Map<string, ActorDisplay>();
  for (const id of new Set(actorIds)) {
    result.set(id, pickActor(id, null, liveNames));
  }
  return result;
}

/**
 * Batch-resolve user-shaped actor IDs to their *current* Clerk display names.
 * One Clerk API call regardless of input length. Returns a Map containing only
 * the IDs that resolved — callers fall back (snapshot → "Former member") for
 * the rest via `pickActor`.
 */
export async function resolveActorNames(
  actorIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const userIds = Array.from(new Set(actorIds.filter(isClerkUserId)));
  if (userIds.length === 0) return result;

  try {
    const cc = await clerkClient();
    const list = await cc.users.getUserList({ userId: userIds });
    for (const user of list.data) {
      const display =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.emailAddresses?.[0]?.emailAddress ||
        "";
      if (display) result.set(user.id, display);
    }
  } catch (err) {
    console.error("[activity] clerk lookup failed:", err);
  }

  return result;
}

/**
 * Attach a resolved `actor` display to each activity row. Prefers the live
 * Clerk name, then the `metadata.actorName` snapshot (survives departed
 * members), then "Former member" — see `pickActor`.
 */
export async function hydrateRowActors<
  T extends { actorId: string; metadata: unknown },
>(rows: T[]): Promise<Array<T & { actor: ActorDisplay }>> {
  const liveNames = await resolveActorNames(rows.map((r) => r.actorId));
  return rows.map((r) => ({
    ...r,
    actor: pickActor(r.actorId, r.metadata, liveNames),
  }));
}
