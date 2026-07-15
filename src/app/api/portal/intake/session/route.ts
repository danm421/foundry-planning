import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { hasUnsubmittedPrefilledForm } from "@/lib/intake/queries";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived, single-use Clerk sign-in token for the CURRENT
 * authenticated portal client. The mobile app hands this ticket to the
 * public `/intake/enter` web route, which consumes it to establish a web
 * cookie session (Bearer→cookie transfer for the same identity) so the
 * WebView can load the `/portal/intake` wizard.
 *
 * Not rate-limited / not audited by design: self-scoped, single-use, 5-min
 * token for an already-authenticated user — no escalation or enumeration
 * surface, and the shared limiter is fail-closed (would break the action
 * when Upstash is unset). Mirrors sibling client-mode POST /push-tokens.
 */
export async function POST(): Promise<Response> {
  try {
    const { clientId, mode, clerkUserId } = await resolvePortalClient();
    if (mode !== "client") {
      return NextResponse.json({ error: "Client mode only" }, { status: 403 });
    }
    if (!(await hasUnsubmittedPrefilledForm(clientId))) {
      return NextResponse.json({ error: "No pending intake form" }, { status: 409 });
    }
    const cc = await clerkClient();
    const token = await cc.signInTokens.createSignInToken({ userId: clerkUserId, expiresInSeconds: 300 });
    return NextResponse.json({ ticket: token.token });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
