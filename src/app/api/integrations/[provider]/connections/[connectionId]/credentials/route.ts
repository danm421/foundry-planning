import { NextResponse } from "next/server";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkIntegrationOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { updateByokCredentials } from "@/lib/integrations/connections";
import { recordAudit } from "@/lib/audit";
import { readTestedAddeparCredentials } from "../../../_addepar";
import { resolveOwnedConnection } from "../_owned";

/**
 * POST — reconnect an Addepar connection with a fresh key: the same body as
 * connect, tested before anything is stored, then written onto the same row
 * so its household links carry on. Addepar only; an OAuth provider reconnects
 * through its own redirect flow.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string; connectionId: string }> },
): Promise<Response> {
  try {
    const owned = await resolveOwnedConnection(params);
    if (!owned || owned.provider.id !== "addepar") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { provider, connection, firmId, userId } = owned;

    await requireActiveSubscriptionForFirm(firmId);

    // The same per-advisor bucket as connect and test.
    const rl = await checkIntegrationOauthLimit(`${provider.id}:${userId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} connection attempts. Please try again shortly.`);
    }

    const tested = await readTestedAddeparCredentials(req, firmId);
    if ("error" in tested) return NextResponse.json({ error: tested.error }, { status: 400 });

    await updateByokCredentials({ connectionId: connection.id, userId, ...tested });
    await recordAudit({
      action: "integration.connect",
      resourceType: "integration_connection",
      resourceId: connection.id,
      firmId,
      metadata: { provider: provider.id, connectionId: connection.id, reconnect: true },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/connections/[connectionId]/credentials error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
