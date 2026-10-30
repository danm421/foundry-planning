import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireOrgAdminOrOwner } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { deleteFirmWorkspace } from "@/lib/workspace/approvals";
import { WorkspaceImpersonationError } from "@/lib/workspace/errors";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { isImpersonating } from "@/lib/workspace/impersonation";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/**
 * "Disconnect everyone": removes every advisor's connected addresses, pending
 * sign-ins and the Microsoft approval, every provider. Not gated on the
 * subscription: a lapsed or departing firm must always be able to pull its
 * credentials back out of us.
 */
export async function POST(): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await requireOrgAndUser();
    if (await isImpersonating()) throw new WorkspaceImpersonationError();

    await deleteFirmWorkspace(firmId);
    await recordAudit({
      action: "workspace.firm_disconnect",
      resourceType: "workspace_firm",
      resourceId: firmId,
      firmId,
      metadata: { provider: "all" },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
