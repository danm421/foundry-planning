import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { disconnectConnection } from "@/lib/orion/connections";
import { recordAudit } from "@/lib/audit";

export async function POST(): Promise<Response> {
  try {
    // Correction 1: requireOrgAdminOrOwner() returns void — get ids from auth() separately
    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }

    await disconnectConnection(firmId);
    await recordAudit({
      action: "orion_integration.disconnect",
      resourceType: "orion_connection",
      resourceId: firmId,
      firmId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Correction 2: authErrorResponse returns { status, body } | null, not a Response
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/orion/disconnect error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
