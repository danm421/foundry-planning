import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { checkIntegrationSyncLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { syncFirm } from "@/lib/integrations/sync";
import { ProviderNotConfigured } from "@/lib/integrations/errors";
import { resolveProvider } from "../_provider";

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

    // A per-client sync is a per-client action — the owning advisor may run it.
    // A firm-wide sync touches every advisor's book, so it stays admin-only.
    let firmId: string;
    if (clientId) {
      const access = await requireClientEditAccess(clientId);
      // As with claim: a cross-firm share does not license the owning firm's
      // provider credentials.
      if (access.access !== "own") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      firmId = access.firmId;
    } else {
      await requireOrgAdminOrOwner();
      const { orgId } = await auth();
      if (!orgId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
      firmId = orgId;
    }

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = await checkIntegrationSyncLimit(`${provider.id}:${firmId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} sync requests. Please try again shortly.`);
    }

    const result = await syncFirm(firmId, provider.id, { trigger: "manual", userId, clientId });
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
