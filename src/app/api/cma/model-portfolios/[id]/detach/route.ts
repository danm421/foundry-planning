import { NextResponse } from "next/server";
import { db } from "@/db";
import { eq, and } from "drizzle-orm";
import { modelPortfolios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/cma/model-portfolios/[id]/detach
 *
 * Stop syncing this portfolio from its source fund portfolio. One-way: the
 * allocations stay exactly as they are and become hand-editable. Offered because
 * the alternative — letting an advisor edit a synced portfolio — means the next
 * sync silently clobbers their work.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { id } = await params;

    const [updated] = await db
      .update(modelPortfolios)
      .set({ sourceTickerPortfolioId: null, updatedAt: new Date() })
      .where(and(eq(modelPortfolios.id, id), eq(modelPortfolios.firmId, firmId)))
      .returning({ id: modelPortfolios.id });

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await recordAudit({
      action: "cma.model_portfolio.detach",
      resourceType: "cma.model_portfolio",
      resourceId: id,
      firmId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/model-portfolios/[id]/detach error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
