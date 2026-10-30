import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireOrgAdminOrOwner } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { uuidRegex } from "@/lib/schemas/common";
import { deleteConnection, getConnectionById } from "@/lib/workspace/connections";
import { WorkspaceConnectionNotFoundError, WorkspaceImpersonationError } from "@/lib/workspace/errors";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { isImpersonating } from "@/lib/workspace/impersonation";
import { adapterFor } from "@/lib/workspace/provider-adapter";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/**
 * An admin drops one advisor's connected address: the grant is revoked at the
 * provider (best effort), then its stored tokens go. Any connection in the
 * admin's own firm, whatever its status. Not gated on the subscription:
 * pulling credentials back out of us is never billing's to block.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await requireOrgAndUser();
    if (await isImpersonating()) throw new WorkspaceImpersonationError();

    const { connectionId } = await params;
    // Not a uuid names no connection; querying the uuid column with it would fail as a 500.
    if (!uuidRegex.test(connectionId)) throw new WorkspaceConnectionNotFoundError();
    const conn = await getConnectionById(connectionId);
    // getConnectionById checks no firm: another firm's row is "not found".
    if (!conn || conn.firmId !== firmId) throw new WorkspaceConnectionNotFoundError();

    await adapterFor(conn.provider).revoke(conn);
    // No owner restriction: the admin removes an advisor's row, not their own.
    await deleteConnection(firmId, conn.id);

    await recordAudit({
      action: "workspace.admin_disconnect",
      resourceType: "workspace_connection",
      resourceId: conn.id,
      firmId,
      metadata: { provider: conn.provider, connectionId: conn.id, userId: conn.userId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
