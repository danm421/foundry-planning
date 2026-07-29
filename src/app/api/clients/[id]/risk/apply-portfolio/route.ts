// src/app/api/clients/[id]/risk/apply-portfolio/route.ts
//
// POST /api/clients/[id]/risk/apply-portfolio -- advisor-triggered, one-shot
// application of the household's composite risk level to the base scenario's
// model portfolio. Deliberately manual, not automatic: capacity depends on the
// projection and the projection depends on the model portfolio, so
// auto-applying on every composite change risks a non-converging loop
// (capacity -> composite -> portfolio -> returns -> funding score ->
// capacity), and would mean an unrelated expense edit silently changes an
// allocation. Does NOT call recomputeProfile -- the next capacity compute
// picks up the changed allocation on its own.
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientRiskProfiles } from "@/db/schema";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { resolveScenarioId } from "@/lib/compute-cache/resolve-scenario-id";
import {
  resolveRiskPortfolioId,
  applyRiskPortfolioToScenario,
} from "@/lib/cma/resolve-risk-portfolio";
import { RISK_LEVEL_LABELS } from "@/lib/risk-levels";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const [profile] = await db
      .select({ compositeLevel: clientRiskProfiles.compositeLevel })
      .from(clientRiskProfiles)
      .where(
        and(eq(clientRiskProfiles.clientId, clientId), eq(clientRiskProfiles.firmId, firmId)),
      );

    const level = profile?.compositeLevel ?? null;
    if (!level) {
      return NextResponse.json(
        { error: "This household has no composite risk level yet" },
        { status: 400 },
      );
    }

    const portfolioId = await resolveRiskPortfolioId(firmId, level);
    if (!portfolioId) {
      return NextResponse.json(
        { error: `No model portfolio is tagged ${RISK_LEVEL_LABELS[level]}` },
        { status: 400 },
      );
    }

    // A household with no base scenario is a 400, not an unhandled 500 --
    // resolveScenarioId throws rather than returning null.
    let baseScenarioId: string;
    try {
      baseScenarioId = await resolveScenarioId(clientId, "base");
    } catch {
      return NextResponse.json(
        { error: "This household has no base scenario to apply a portfolio to" },
        { status: 400 },
      );
    }

    await db.transaction(async (tx) => {
      await applyRiskPortfolioToScenario(tx, baseScenarioId, portfolioId);
    });

    await recordAudit({
      action: "risk_profile.portfolio_applied",
      resourceType: "client_risk_profile",
      resourceId: clientId,
      clientId,
      firmId,
      metadata: {
        ...crossFirmAuditMeta({ access }, callerOrg),
        level,
        portfolioId,
      },
    });

    return NextResponse.json({ ok: true, level, portfolioId });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/clients/[id]/risk/apply-portfolio error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
