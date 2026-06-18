// src/app/api/clients/[id]/life-insurance/settings/route.ts
//
// PUT /api/clients/[id]/life-insurance/settings
//
// Persists the Life Insurance solver assumptions for a client. The
// solver tab autosaves through this route as the advisor edits.
// One row per client (UNIQUE on clientId) — see
// `saveLifeInsuranceSettings`. Allowlisted in the active-subscription
// lint for parity with the rest of the per-client mutation routes.
import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { assertModelPortfoliosInFirm } from "@/lib/db-scoping";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { LI_ASSUMPTIONS_SCHEMA } from "@/lib/life-insurance/schema";
import { saveLifeInsuranceSettings } from "@/lib/life-insurance/settings";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = LI_ASSUMPTIONS_SCHEMA.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // A modelPortfolioId from another firm must be rejected — otherwise it is
    // written and silently falls back to DEFAULT_LI_GROWTH at solve time,
    // producing wrong proceeds growth and leaving orphaned cross-firm data
    // (F14). assertModelPortfoliosInFirm no-ops on null/empty ids.
    const mpCheck = await assertModelPortfoliosInFirm(firmId, [
      parsed.data.modelPortfolioId,
    ]);
    if (!mpCheck.ok) {
      return NextResponse.json({ error: mpCheck.reason }, { status: 400 });
    }

    await saveLifeInsuranceSettings(clientId, parsed.data);

    await recordAudit({
      action: "life_insurance_solver_settings.update",
      resourceType: "life_insurance_solver_settings",
      resourceId: clientId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error(
      "PUT /api/clients/[id]/life-insurance/settings error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
