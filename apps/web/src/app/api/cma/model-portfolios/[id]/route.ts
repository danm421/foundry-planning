import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { modelPortfolios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdmin } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgAdmin();
    const firmId = await getOrgId();
    const { id } = await params;
    const body = await request.json();

    const [updated] = await db
      .update(modelPortfolios)
      .set({ name: body.name, description: body.description ?? null, updatedAt: new Date() })
      .where(and(eq(modelPortfolios.id, id), eq(modelPortfolios.firmId, firmId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /api/cma/model-portfolios/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgAdmin();
    const firmId = await getOrgId();
    const { id } = await params;

    await db
      .delete(modelPortfolios)
      .where(and(eq(modelPortfolios.id, id), eq(modelPortfolios.firmId, firmId)));

    await recordAudit({
      action: "cma.model_portfolio.delete",
      resourceType: "model_portfolio",
      resourceId: id,
      firmId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("DELETE /api/cma/model-portfolios/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
