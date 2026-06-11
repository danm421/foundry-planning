import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tickerPortfolios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { id } = await params;
    const body = await request.json();

    if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim() === "")) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }

    const [updated] = await db
      .update(tickerPortfolios)
      .set({ name: body.name, description: body.description ?? null, updatedAt: new Date() })
      .where(and(eq(tickerPortfolios.id, id), eq(tickerPortfolios.firmId, firmId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await recordAudit({
      action: "cma.ticker_portfolio.update",
      resourceType: "cma.ticker_portfolio",
      resourceId: id,
      firmId,
      metadata: { name: updated.name },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PATCH /api/cma/ticker-portfolios/[id] error:", err);
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
      .delete(tickerPortfolios)
      .where(and(eq(tickerPortfolios.id, id), eq(tickerPortfolios.firmId, firmId)));

    await recordAudit({
      action: "cma.ticker_portfolio.delete",
      resourceType: "cma.ticker_portfolio",
      resourceId: id,
      firmId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("DELETE /api/cma/ticker-portfolios/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
