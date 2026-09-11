import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * The gate for the `/api/portal/*` handlers that span FIRMS.
 *
 * Deliberately WEAKER than `requireClientPortalAccess`, and that is the whole
 * point of it being its own function. That gate resolves the ONE active
 * household and checks its firm's `client_portal` entitlement, its
 * subscription, and (on mutations) its edit-enabled flag. Three endpoints must
 * not inherit any of that, because none of them is about a single firm:
 *
 *  - `/api/portal/requests` serves the person being asked for their FIRST
 *    binding, who by definition holds no household to check an entitlement
 *    against.
 *  - `/api/portal/connections` lists every firm holding this login and ends any
 *    of them; gating it on the ACTIVE household's firm would let one firm
 *    switching the portal off take away the client's ability to leave a
 *    DIFFERENT firm.
 *  - `/api/portal/active-household` moves between them, so the same firm could
 *    otherwise trap the client inside the household it had just switched off.
 *
 * What authorizes the caller instead is the session PLUS the `clerkUserId`
 * predicate inside `bindings.ts`: every row those handlers read or write is
 * scoped to the caller, and no user id is ever accepted from a request body.
 *
 * Extracted rather than copied a fourth time because it is an AUTHORIZATION
 * predicate — three byte-identical inlined copies are three places for one of
 * them to quietly drift, and the 403 string is client-visible.
 *
 * `orgId` present means an ADVISOR session, which must never read a portal
 * client's surfaces even when the same human holds both.
 */
export async function requirePortalSession(): Promise<{ userId: string } | Response> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (orgId) {
    return NextResponse.json({ error: "Advisor session — portal access denied" }, { status: 403 });
  }
  return { userId };
}
