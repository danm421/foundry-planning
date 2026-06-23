import { clerkClient } from "@clerk/nextjs/server";
import { bindClerkUserToClient } from "@/lib/portal/bind-portal-user";

/**
 * Self-heal a portal binding on the first authenticated request. When a
 * signed-in, org-less user has no `clients.clerk_user_id` row yet, read the
 * clientId that Clerk propagated from the invitation's public_metadata onto the
 * user, then bind it. Returns the bound clientId, or null if this user is not a
 * pending portal client.
 *
 * Fail-safe: any Clerk/DB error returns null so middleware never 500s.
 */
export async function claimPortalBinding(
  clerkUserId: string,
): Promise<string | null> {
  if (!clerkUserId) return null;
  try {
    const cc = await clerkClient();
    const user = await cc.users.getUser(clerkUserId);
    const clientId = (user.publicMetadata as { clientId?: string } | undefined)
      ?.clientId;
    if (!clientId) return null;

    const result = await bindClerkUserToClient(clientId, clerkUserId, "self-heal");
    return result.ok ? result.clientId : null;
  } catch (err) {
    console.error("[portal] claimPortalBinding failed", err);
    return null;
  }
}
