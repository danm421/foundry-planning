// src/app/api/clients/[id]/risk/tolerance/route.ts
//
// PUT /api/clients/[id]/risk/tolerance -- advisor sets the rung by hand,
// skipping the questionnaire. Reasoning is mandatory.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { MANUAL_TOLERANCE_SCHEMA } from "@/lib/risk/schema";
import { BAND_CENTERS } from "@/lib/risk/scoring";
import { recomputeProfile } from "@/lib/risk/profile";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = MANUAL_TOLERANCE_SCHEMA.safeParse(await req.json());
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
      kind: "tolerance_manual",
      reason: parsed.data.reason,
      patch: {
        toleranceScore: BAND_CENTERS[parsed.data.level],
        toleranceSource: "manual",
        toleranceConfirmedAt: new Date(),
        rtqVersion: null,
      },
    });

    await recordAudit({
      action: "risk_profile.tolerance_manual",
      resourceType: "client_risk_profile",
      resourceId: clientId,
      clientId,
      firmId,
      metadata: {
        ...crossFirmAuditMeta({ access }, callerOrg),
        level: parsed.data.level,
      },
    });

    return NextResponse.json({ ok: true, profile: row });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /api/clients/[id]/risk/tolerance error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
