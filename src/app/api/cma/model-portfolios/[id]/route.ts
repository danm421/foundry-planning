import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { modelPortfolios } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { isRiskLevel, RISK_LEVEL_LABELS, type RiskLevel } from "@/lib/risk-levels";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { id } = await params;
    const body = await request.json();

    // Only touch columns actually present in the body (partial-safe): a call
    // that only tags a risk level must not blank out name/description.
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if ("name" in body) patch.name = body.name;
    if ("description" in body) patch.description = body.description ?? null;

    if ("riskLevel" in body) {
      const rawRl = body.riskLevel;
      if (rawRl !== null && !isRiskLevel(rawRl)) {
        return NextResponse.json({ error: "Invalid risk level" }, { status: 400 });
      }
      // TS can't narrow `rawRl` through the negated `&&` above (it's `any`
      // coming off `request.json()`), so rebind explicitly now that we know
      // it's either null or a validated rung.
      const rl: RiskLevel | null = rawRl;
      if (rl !== null) {
        // Enforce one-portfolio-per-rung deterministically with a friendly
        // message (the DB partial unique index is the backstop).
        const [taken] = await db
          .select({ id: modelPortfolios.id, name: modelPortfolios.name })
          .from(modelPortfolios)
          .where(and(
            eq(modelPortfolios.firmId, firmId),
            eq(modelPortfolios.riskLevel, rl),
            ne(modelPortfolios.id, id),
          ))
          .limit(1);
        if (taken) {
          return NextResponse.json(
            { error: `"${taken.name}" is already tagged ${RISK_LEVEL_LABELS[rl]} — untag it first.` },
            { status: 409 },
          );
        }
      }
      patch.riskLevel = rl;
    }

    const [updated] = await db
      .update(modelPortfolios)
      .set(patch)
      .where(and(eq(modelPortfolios.id, id), eq(modelPortfolios.firmId, firmId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await recordAudit({
      action: "cma.model_portfolio.update",
      resourceType: "cma.model_portfolio",
      resourceId: id,
      firmId,
      metadata: { name: updated.name },
    });

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
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
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
