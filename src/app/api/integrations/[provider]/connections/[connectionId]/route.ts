import { NextResponse } from "next/server";
import { deleteConnectionById } from "@/lib/integrations/connections";
import { recordAudit } from "@/lib/audit";
import { resolveOwnedConnection } from "./_owned";

/**
 * DELETE — the owner removes their connection and its household links. Plan
 * accounts are untouched and keep their numbers. Not gated on the
 * subscription, like disconnect.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string; connectionId: string }> },
): Promise<Response> {
  try {
    const owned = await resolveOwnedConnection(params);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { provider, connection, firmId } = owned;

    const linksRemoved = await deleteConnectionById(connection.id);
    await recordAudit({
      action: "integration.connection.delete",
      resourceType: "integration_connection",
      resourceId: connection.id,
      firmId,
      metadata: { provider: provider.id, connectionId: connection.id, linksRemoved },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/integrations/[provider]/connections/[connectionId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
