/**
 * Pure (IO-free) actor-name resolution helpers, shared by the activity feed's
 * server render and its load-more API. The Clerk lookup itself lives in
 * `resolve-actors.ts`; this file holds only the classification + precedence
 * logic so it can be unit-tested without the Clerk SDK.
 */

export type ActorDisplay = {
  name: string;
  isSystem: boolean;
};

const SYSTEM_ACTOR_IDS = new Set(["system", "clerk:webhook"]);

/** Clerk user IDs are the only actor shape we can resolve to a person. */
export function isClerkUserId(actorId: string): boolean {
  return actorId.startsWith("user_");
}

/**
 * Non-user actor shapes get a fixed label without any lookup:
 *  - "" / whitespace — several `recordActivity` call sites pass
 *    `actorUserId: userId ?? ""` for unattended writes; an empty actor is
 *    system-initiated, not a departed member.
 *  - "system" / "clerk:webhook" — unattended jobs, webhooks, crons
 *  - "org_…" — a Clerk org ID; only appears as a historical data artifact
 *    (a bulk/test path that mis-stamped the firm ID as the actor). Labelled
 *    "System" rather than left to fall through to "Former member".
 * Returns null for user-shaped IDs, which the caller resolves via Clerk.
 */
export function classifyActor(actorId: string): ActorDisplay | null {
  // Several write paths pass `userId ?? ""`. An empty actor is an unattended
  // action, not a departed member — without this it falls through to
  // "Former member" and misattributes system writes.
  if (!actorId.trim()) return { name: "System", isSystem: true };
  if (SYSTEM_ACTOR_IDS.has(actorId)) return { name: "System", isSystem: true };
  if (actorId.startsWith("org_")) return { name: "System", isSystem: true };
  return null;
}

/** Reads the display name snapshotted into `metadata.actorName` at write time. */
export function actorNameFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const name = (metadata as Record<string, unknown>).actorName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * Resolve one row's actor to a display name, in precedence order:
 *  1. Fixed label for non-user actors (system / webhook / org artifact).
 *  2. Live Clerk name — current, reflects renames (from `liveNames`).
 *  3. Snapshotted `metadata.actorName` — preserves a departed member's name.
 *  4. "Former member" — a user ID Clerk no longer returns and no snapshot.
 */
export function pickActor(
  actorId: string,
  metadata: unknown,
  liveNames: Map<string, string>,
): ActorDisplay {
  const classified = classifyActor(actorId);
  if (classified) return classified;

  const live = liveNames.get(actorId);
  if (live) return { name: live, isSystem: false };

  const snapshot = actorNameFromMetadata(metadata);
  if (snapshot) return { name: snapshot, isSystem: false };

  return { name: "Former member", isSystem: false };
}
