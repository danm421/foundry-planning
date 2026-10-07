import type { clerkClient } from "@clerk/nextjs/server";

const CLERK_PAGE = 100;

/**
 * Every Clerk user id in one organization's membership list. The server's
 * default page is not "all", so this pages explicitly against `totalCount`.
 * Any Clerk error propagates, including the 404 for an organization that no
 * longer exists (see `isMissingOrganizationError`). Callers that loop over
 * firms wrap this one call in their try/catch: a `continue` in a catch nested
 * inside the paging loop would restart the CURRENT page forever.
 */
export async function memberUserIdsForOrg(
  cc: Awaited<ReturnType<typeof clerkClient>>,
  organizationId: string,
): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += CLERK_PAGE) {
    const { data, totalCount } = await cc.organizations.getOrganizationMembershipList({
      organizationId,
      limit: CLERK_PAGE,
      offset,
    });
    for (const m of data) {
      const uid = m.publicUserData?.userId;
      if (uid) out.push(uid);
    }
    if (data.length === 0 || offset + data.length >= totalCount) break;
  }
  return out;
}
