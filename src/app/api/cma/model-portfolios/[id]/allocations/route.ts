import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { modelPortfolios, modelPortfolioAllocations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// PUT /api/cma/model-portfolios/[id]/allocations — replace all allocations
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { id } = await params;

    // Verify portfolio belongs to this firm
    const [portfolio] = await db
      .select()
      .from(modelPortfolios)
      .where(and(eq(modelPortfolios.id, id), eq(modelPortfolios.firmId, firmId)));

    if (!portfolio) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const allocations: { assetClassId: string; weight: string }[] = body.allocations ?? [];

    // Validate weights sum to ~1.0
    const totalWeight = allocations.reduce((s, a) => s + Number(a.weight), 0);
    if (allocations.length > 0 && Math.abs(totalWeight - 1.0) > 0.001) {
      return NextResponse.json(
        { error: `Weights must sum to 100% (got ${(totalWeight * 100).toFixed(1)}%)` },
        { status: 400 }
      );
    }

    // Delete existing allocations and insert new ones
    await db
      .delete(modelPortfolioAllocations)
      .where(eq(modelPortfolioAllocations.modelPortfolioId, id));

    if (allocations.length > 0) {
      await db.insert(modelPortfolioAllocations).values(
        allocations.map((a) => ({
          modelPortfolioId: id,
          assetClassId: a.assetClassId,
          weight: a.weight,
        }))
      );
    }

    // Return updated allocations
    const updated = await db
      .select()
      .from(modelPortfolioAllocations)
      .where(eq(modelPortfolioAllocations.modelPortfolioId, id));

    await recordAudit({
      action: "cma.model_portfolio.allocation.update",
      resourceType: "cma.model_portfolio",
      resourceId: id,
      firmId,
      metadata: { count: updated.length },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /api/cma/model-portfolios/[id]/allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
