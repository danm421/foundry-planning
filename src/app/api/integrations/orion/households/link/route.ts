import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { findClientInFirm } from "@/lib/db-scoping";
import { linkHousehold, unlinkHousehold } from "@/lib/orion/households";

export async function POST(req: Request): Promise<Response> {
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    const orionHouseholdId = typeof body?.orionHouseholdId === "string" ? body.orionHouseholdId : null;
    if (!clientId || !orionHouseholdId) {
      return NextResponse.json({ error: "clientId and orionHouseholdId are required" }, { status: 400 });
    }

    const client = await findClientInFirm(clientId, firmId);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    await linkHousehold({ firmId, clientId, orionHouseholdId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/orion/households/link error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await auth();
    if (!firmId) return NextResponse.json({ error: "No active organization" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

    const client = await findClientInFirm(clientId, firmId);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    await unlinkHousehold(firmId, clientId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("DELETE /api/integrations/orion/households/link error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
