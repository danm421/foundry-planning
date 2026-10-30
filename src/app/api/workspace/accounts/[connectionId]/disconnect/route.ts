import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { resolveActingConnection } from "@/lib/workspace/acting-connection";
import { deleteConnection } from "@/lib/workspace/connections";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { adapterFor } from "@/lib/workspace/provider-adapter";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/**
 * The advisor drops one of their own connected accounts: the grant is revoked
 * at the provider (best effort), then its stored tokens go. A connection that
 * needs to reconnect can still be disconnected. Not gated on the subscription:
 * pulling your tokens back out is never billing's to block.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { connectionId } = await params;

    const conn = await resolveActingConnection({
      firmId,
      actorUserId: userId,
      connectionId,
      allowNeedsReconnect: true,
    });
    await adapterFor(conn.provider).revoke(conn);
    // The owner's id (never ""), so the delete is always restricted to the owner's row.
    await deleteConnection(firmId, conn.id, { userId: conn.userId });

    await recordAudit({
      action: "workspace.disconnect",
      resourceType: "workspace_connection",
      resourceId: conn.id,
      firmId,
      metadata: { provider: conn.provider, connectionId: conn.id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
