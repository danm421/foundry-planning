import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { generatePkce, generateState } from "@/lib/integrations/pkce";
import { createOauthState } from "@/lib/integrations/connections";
import { checkIntegrationOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { resolveProvider } from "../_provider";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });

    // requireOrgAdminOrOwner() returns void — get ids from auth() separately
    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await checkIntegrationOauthLimit(`${provider.id}:${firmId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} connection attempts. Please try again shortly.`);
    }

    const { verifier, challenge } = generatePkce();
    const state = generateState();
    await createOauthState({ firmId, providerId: provider.id, userId, state, codeVerifier: verifier, ttlMs: 600_000 });
    return NextResponse.redirect(provider.oauth.buildAuthorizeUrl({ state, challenge }));
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("GET /api/integrations/[provider]/connect error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
