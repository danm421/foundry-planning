// src/app/api/clients/[id]/risk/environment/route.ts
//
// PUT /api/clients/[id]/risk/environment -- advisor records a bounded
// adjustment to tolerance for real, off-plan circumstances (job loss risk,
// health event, windfall). Capacity still caps the composite -- this only
// moves the tolerance side of the ceiling. Reasoning is mandatory whenever
// the adjustment is non-zero (enforced by ENVIRONMENT_SCHEMA and the DB
// check constraint).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { ENVIRONMENT_SCHEMA } from "@/lib/risk/schema";
import { recomputeProfile } from "@/lib/risk/profile";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = ENVIRONMENT_SCHEMA.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { userId } = await auth();
    const row = await recomputeProfile({
      clientId,
      firmId,
      actorUserId: userId ?? null,
      kind: "environment_changed",
      reason: parsed.data.reason ?? null,
      patch: {
        environmentAdj: parsed.data.adjustment,
        environmentReason: parsed.data.reason ?? null,
        environmentUpdatedAt: new Date(),
      },
    });

    await recordAudit({
      action: "risk_profile.environment_changed",
      resourceType: "client_risk_profile",
      resourceId: clientId,
      clientId,
      firmId,
      metadata: {
        ...crossFirmAuditMeta({ access }, callerOrg),
        adjustment: parsed.data.adjustment,
      },
    });

    return NextResponse.json({ ok: true, profile: row });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /api/clients/[id]/risk/environment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
