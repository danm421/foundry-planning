import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { deleteUserConnection } from "@/lib/workspace/connections";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/**
 * The signed-in advisor drops their own Microsoft connection (its stored
 * tokens). The session names whose row goes; the route takes no user id. Not
 * gated on the subscription: pulling your tokens back out is never billing's
 * to block.
 */
export async function POST(): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();

    await deleteUserConnection(firmId, userId, "microsoft");
    await recordAudit({
      action: "workspace.disconnect",
      resourceType: "workspace_connection",
      resourceId: userId,
      firmId,
      metadata: { provider: "microsoft", userId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
