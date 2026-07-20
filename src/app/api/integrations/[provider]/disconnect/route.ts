import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { disconnectConnection } from "@/lib/integrations/connections";
import { recordAudit } from "@/lib/audit";
import { resolveProvider } from "../_provider";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });

    // requireOrgAdminOrOwner() returns void — get ids from auth() separately
    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }

    await disconnectConnection(firmId, provider.id);
    await recordAudit({
      action: "integration.disconnect",
      resourceType: "integration_connection",
      resourceId: firmId,
      firmId,
      metadata: { provider: provider.id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/disconnect error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
