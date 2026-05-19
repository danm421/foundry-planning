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
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";
import { LI_ASSUMPTIONS_SCHEMA } from "@/lib/life-insurance/schema";
import { saveLifeInsuranceSettings } from "@/lib/life-insurance/settings";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await ctx.params;

    const inFirm = await findClientInFirm(clientId, firmId);
    if (!inFirm) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const parsed = LI_ASSUMPTIONS_SCHEMA.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await saveLifeInsuranceSettings(clientId, parsed.data);

    await recordAudit({
      action: "life_insurance_solver_settings.update",
      resourceType: "life_insurance_solver_settings",
      resourceId: clientId,
      clientId,
      firmId,
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
