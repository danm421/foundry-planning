import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { findClientInFirm } from "@/lib/db-scoping";
import { linkHousehold, unlinkHousehold } from "@/lib/integrations/households";
import { resolveProvider } from "../../_provider";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });

    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    const externalHouseholdId =
      typeof body?.externalHouseholdId === "string" ? body.externalHouseholdId : null;
    if (!clientId || !externalHouseholdId) {
      return NextResponse.json({ error: "clientId and externalHouseholdId are required" }, { status: 400 });
    }

    const client = await findClientInFirm(clientId, firmId);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    await linkHousehold({ firmId, providerId: provider.id, clientId, externalHouseholdId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/households/link error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });

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
    console.error("DELETE /api/integrations/[provider]/households/link error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
