import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { listActiveBindings } from "@/lib/portal/bindings";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/portal/active-household";

export const dynamic = "force-dynamic";

/** A year. The selection is a preference, not a session — a client who signs
 *  back in months later should land where they left off. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Switch which household this portal session is looking at.
 *
 * Lives at `/api/portal/active-household` rather than `/api/portal/household`:
 * that path is already taken by the household PROFILE endpoint (GET/PUT on the
 * client's own contacts), which is gated by `resolvePortalClient` plus the
 * portal subscription and edit-enabled checks. This handler must NOT inherit
 * any of those — see the gate below — and folding a deliberately un-gated
 * handler into that file would leave the next person to add a shared guard
 * there silently breaking it. The name also matches the module that owns the
 * cookie, `@/lib/portal/active-household`.
 *
 * NOT gated by `requireClientPortalAccess`, for the same reason
 * `/api/portal/connections` is not: that gate resolves the ONE active household
 * and checks its firm's `client_portal` entitlement, but this endpoint spans
 * every firm the login is bound to. A single firm switching the portal off
 * would otherwise trap the client inside that firm's household with no way to
 * move to another one.
 *
 * The authorization is the session plus the `clerkUserId` predicate inside
 * `bindings.ts`: no user id is ever accepted from the body, and the only thing
 * that can be written to the cookie is a household this login already holds.
 *
 * The cookie is a convenience, not a credential — `pickActiveBinding` discards
 * a value naming a household the user does not hold. We refuse it here anyway
 * so a switch to a household you have lost fails loudly at the moment you press
 * it, rather than silently landing you somewhere else.
 */
export async function POST(req: Request): Promise<Response> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (orgId) {
    return NextResponse.json({ error: "Advisor session — portal access denied" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { clientId?: unknown };
  if (typeof body.clientId !== "string") {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  const clientId = body.clientId;

  // Scope by the caller's OWN bindings before writing anything.
  const bindings = await listActiveBindings(userId);
  if (!bindings.some((b) => b.clientId === clientId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  (await cookies()).set(ACTIVE_HOUSEHOLD_COOKIE, clientId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return NextResponse.json({ ok: true });
}
