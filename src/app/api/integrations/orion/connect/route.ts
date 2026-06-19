import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { generatePkce, generateState, buildAuthorizeUrl } from "@/lib/orion/oauth";
import { createOauthState } from "@/lib/orion/connections";
import { checkOrionOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";

export async function GET(): Promise<Response> {
  try {
    // Correction 1: requireOrgAdminOrOwner() returns void — get ids from auth() separately
    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Correction 3: rateLimitErrorResponse takes two args (rl, message)
    const rl = await checkOrionOauthLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many Orion connection attempts. Please try again shortly.");
    }

    const { verifier, challenge } = generatePkce();
    const state = generateState();
    await createOauthState({ firmId, userId, state, codeVerifier: verifier, ttlMs: 600_000 });
    return NextResponse.redirect(buildAuthorizeUrl({ state, challenge }));
  } catch (err) {
    // Correction 2: authErrorResponse returns { status, body } | null, not a Response
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("GET /api/integrations/orion/connect error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
