import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription, requireOrgAdminOrOwner } from "@/lib/authz";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { setMemberAccess } from "@/lib/workspace/access";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ enabled: z.boolean() });

/**
 * Switches one advisor's Microsoft 365 access on or off. The path's `userId`
 * only names whose switch to flip, and must be a member of the caller's own
 * firm. Switching off drops their connection (see `setMemberAccess`).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId: adminId } = await requireOrgAndUser();

    const parsed = await parseBody(bodySchema, req);
    if (!parsed.ok) return parsed.response;
    const { enabled } = parsed.data;
    // Only switching ON is gated: a lapsed firm must still be able to cut an advisor off.
    if (enabled) await requireActiveSubscription();

    const { userId } = await params;
    const members = await listFirmMembers(firmId);
    if (!members.some((m) => m.userId === userId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await setMemberAccess({ firmId, provider: "microsoft", userId, enabled, updatedByUserId: adminId });
    await recordAudit({
      action: "workspace.member_access",
      resourceType: "workspace_member_access",
      resourceId: userId,
      firmId,
      metadata: { userId, enabled },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
