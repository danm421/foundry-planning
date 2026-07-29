import { requireOrgAdminOrOwner } from "@/lib/authz";
import { getAdvisorProfile } from "@/lib/branding/advisor-profile";

/**
 * Throws ForbiddenError (or UnauthorizedError) unless `callerUserId` may edit
 * `target`'s advisor brand. The rule, verbatim from the PUT handler it was
 * extracted from:
 *
 *   You may edit advisor X's brand if EITHER
 *     (a) X is you AND your own profile has `brandingEnabled`, OR
 *     (b) you are a firm admin — in which case the target's grant is
 *         irrelevant, so an admin can prep a brand before flipping it on.
 *
 * Authorization keys off the CALLER's own grant, never the target's: reading
 * the target's `brandingEnabled` here would let any member write to every
 * granted advisor's brand.
 *
 * Shared by `PUT /api/advisor-branding` and the advisor asset upload/remove
 * server actions. Deliberately one copy — two would drift, and drift in this
 * rule is a privilege bug.
 *
 * NOTE: `getAdvisorProfile` is React-`cache`d and returns the pre-write row
 * within a request (see advisor-profile.ts). This helper only reads, so that
 * is fine — but do not call it after a write and expect fresh state.
 */
export async function assertCanEditAdvisorBranding(
  orgId: string,
  callerUserId: string,
  target: string,
): Promise<void> {
  if (target === callerUserId) {
    const own = await getAdvisorProfile(orgId, callerUserId);
    if (!own?.brandingEnabled) {
      // Self-grant isn't on — only a firm admin may still write it.
      await requireOrgAdminOrOwner();
    }
    return;
  }
  await requireOrgAdminOrOwner();
}
