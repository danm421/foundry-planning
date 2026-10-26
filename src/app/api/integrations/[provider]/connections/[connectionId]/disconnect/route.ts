import { NextResponse } from "next/server";
import { disconnectConnectionById } from "@/lib/integrations/connections";
import { recordAudit } from "@/lib/audit";
import { resolveOwnedConnection } from "../_owned";

/**
 * POST — the owner disconnects their connection: the credentials are wiped
 * and the row and its household links are kept, so a reconnect restores them.
 * Not gated on the subscription: cutting a provider off is never billing's to block.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string; connectionId: string }> },
): Promise<Response> {
  try {
    const owned = await resolveOwnedConnection(params);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { provider, connection, firmId } = owned;

    await disconnectConnectionById(connection.id);
    await recordAudit({
      action: "integration.disconnect",
      resourceType: "integration_connection",
      resourceId: connection.id,
      firmId,
      metadata: { provider: provider.id, connectionId: connection.id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/integrations/[provider]/connections/[connectionId]/disconnect error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
