import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { checkOrionSyncLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { syncFirm } from "@/lib/orion/sync";

export async function POST(req: Request): Promise<Response> {
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = await checkOrionSyncLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many Orion sync requests. Please try again shortly.");
    }

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : undefined;
    const result = await syncFirm(firmId, { trigger: "manual", userId, clientId });
    return NextResponse.json(result);
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/orion/sync error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
