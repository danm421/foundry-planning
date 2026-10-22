import { NextResponse } from "next/server";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkIntegrationSyncLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { syncConnection } from "@/lib/integrations/sync";
import { ProviderNotConfigured } from "@/lib/integrations/errors";
import { resolveOwnedConnection } from "../_owned";

/** POST — "Sync now" on a connection page: the owner syncs every household linked through it. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string; connectionId: string }> },
): Promise<Response> {
  try {
    const owned = await resolveOwnedConnection(params);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { provider, connection, firmId, userId } = owned;

    // A disconnected connection holds no key; syncConnection would refuse it.
    if (connection.status === "disconnected") {
      return NextResponse.json({ error: "Reconnect this connection to sync it." }, { status: 409 });
    }

    await requireActiveSubscriptionForFirm(firmId);

    // Per connection, so one advisor's syncing can't 429 a colleague.
    const rl = await checkIntegrationSyncLimit(`${provider.id}:${connection.id}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} sync requests. Please try again shortly.`);
    }

    // syncConnection audits the run itself, with the connection id.
    const result = await syncConnection(connection.id, { trigger: "manual", userId });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProviderNotConfigured) {
      return NextResponse.json({ error: `${err.providerId} is not yet configured` }, { status: 503 });
    }
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/connections/[connectionId]/sync error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
