// src/app/api/clients/[id]/solver/li-inventory/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadLifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  try {
    await requireOrgId();
    const { id: clientId } = await ctx.params;
    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const { searchParams } = new URL(req.url);
    const clientName = searchParams.get("clientName") ?? "";
    const spouseParam = searchParams.get("spouseName");
    const spouseName = spouseParam && spouseParam.length > 0 ? spouseParam : null;

    const inventory = await loadLifeInsuranceInventory(
      clientId,
      access.firmId,
      clientName,
      spouseName,
    );
    return NextResponse.json(inventory);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /api/clients/[id]/solver/li-inventory error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
