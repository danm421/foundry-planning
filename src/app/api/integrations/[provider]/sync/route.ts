import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { checkIntegrationSyncLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { getHouseholdLinkForClient } from "@/lib/integrations/households";
import { syncConnection } from "@/lib/integrations/sync";
import { ProviderNotConfigured } from "@/lib/integrations/errors";
import { resolveProvider } from "../_provider";

/**
 * POST — sync one client through its link's connection, whoever owns that
 * connection. Syncing a whole connection is its owner's action, not this
 * route's, so `clientId` is required.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  let provider: Awaited<ReturnType<typeof resolveProvider>> = null;
  try {
    provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : undefined;

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

    // A per-client sync is a per-client action — any member of the firm who
    // can see the client may run it (requireClientEditAccess's own-firm path
    // grants "edit" on visibility alone; with bookSiloEnabled off, the
    // default, that's every org:member), without ever seeing the connection.
    const access = await requireClientEditAccess(clientId);
    // As with claim: a cross-firm share does not license the owning firm's
    // provider credentials.
    if (access.access !== "own") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await requireActiveSubscriptionForFirm(access.firmId);

    const link = await getHouseholdLinkForClient(clientId);
    if (!link || link.provider !== provider.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Per-client syncs bucket per USER, not per firm: every advisor can reach
    // this route, and a firm bucket would let one of them spend the whole
    // firm's budget and 429 their colleagues as a side effect — the same
    // reasoning as checkIntegrationClaimLimit (rate-limit.ts).
    const rl = await checkIntegrationSyncLimit(`${provider.id}:${userId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} sync requests. Please try again shortly.`);
    }

    const result = await syncConnection(link.connectionId, { trigger: "manual", userId, clientId });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProviderNotConfigured) {
      return NextResponse.json({ error: `${err.providerId} is not yet configured` }, { status: 503 });
    }
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/sync error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
