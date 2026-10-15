import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { externalBeneficiaries } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { createExternalBeneficiaryForClient } from "@/lib/clients/external-beneficiaries-writes";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(externalBeneficiaries)
      .where(eq(externalBeneficiaries.clientId, id))
      .orderBy(asc(externalBeneficiaries.name));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/external-beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const result = await createExternalBeneficiaryForClient({ clientId: id, input: await request.json() });
    return result.ok
      ? NextResponse.json(result.data, { status: 201 })
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/external-beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
