import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireOrgAdminOrOwner } from "@/lib/authz";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { enableMembers } from "@/lib/workspace/access";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/** Switches Microsoft 365 on for everyone in the firm today. Later joiners start Off. */
export async function POST(): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await requireOrgAndUser();

    const members = await listFirmMembers(firmId);
    const count = await enableMembers({
      firmId,
      provider: "microsoft",
      userIds: members.map((m) => m.userId),
      updatedByUserId: userId,
    });
    await recordAudit({
      action: "workspace.member_access",
      resourceType: "workspace_member_access",
      resourceId: "all",
      firmId,
      metadata: { all: true, count },
    });
    return NextResponse.json({ enabled: count });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
