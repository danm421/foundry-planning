import { clerkClient } from "@clerk/nextjs/server";

const SYSTEM_IDS = new Set(["system", "clerk:webhook"]);

export type ActorDisplay = {
  name: string;
  isSystem: boolean;
};

/**
 * Resolves a list of `actorId` values (Clerk user IDs, "system", or
 * "clerk:webhook") to display names. One Clerk API call regardless of
 * input length.
 */
export async function resolveActors(
  actorIds: string[],
): Promise<Map<string, ActorDisplay>> {
  const result = new Map<string, ActorDisplay>();

  const unique = Array.from(new Set(actorIds));
  const userIds = unique.filter((id) => !SYSTEM_IDS.has(id));

  for (const id of unique) {
    if (SYSTEM_IDS.has(id)) {
      result.set(id, { name: "System", isSystem: true });
    }
  }

  if (userIds.length === 0) return result;

  try {
    const cc = await clerkClient();
    const list = await cc.users.getUserList({ userId: userIds });
    for (const user of list.data) {
      const display =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.emailAddresses?.[0]?.emailAddress ||
        "Unknown user";
      result.set(user.id, { name: display, isSystem: false });
    }
  } catch (err) {
    console.error("[activity] clerk lookup failed:", err);
  }

  for (const id of userIds) {
    if (!result.has(id)) {
      result.set(id, { name: "Former member", isSystem: false });
    }
  }

  return result;
}
