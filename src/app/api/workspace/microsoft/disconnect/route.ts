import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireOrgAdminOrOwner } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { deleteFirmProvider } from "@/lib/workspace/approvals";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/** Removes the firm's Microsoft 365 approval, every advisor's switch and sign-in, and pending states. */
export async function POST(): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await requireOrgAndUser();

    await deleteFirmProvider(firmId, "microsoft");
    await recordAudit({
      action: "workspace.firm_disconnect",
      resourceType: "workspace_firm_approval",
      resourceId: "microsoft",
      firmId,
      metadata: { provider: "microsoft" },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
