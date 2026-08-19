import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { isPortalFeatureKey, type PortalFeatureKey } from "@/lib/portal/features";

export const dynamic = "force-dynamic";

// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(id),
// which verifies the target client belongs to the caller's firm (throws ForbiddenError
// otherwise) before any mutation. The literal getOrgId/requireOrgId grep doesn't see this.

/** Feature key → the column it switches. Also the allowlist: an unrecognised
 *  key never reaches `.set()`, so the body can't reach other client columns. */
const COLUMN_BY_FEATURE: Readonly<
  Record<
    PortalFeatureKey,
    | "portalInvestmentsEnabled"
    | "portalBudgetEnabled"
    | "portalDocumentsEnabled"
    | "portalCalculatorsEnabled"
  >
> = {
  investments: "portalInvestmentsEnabled",
  budget: "portalBudgetEnabled",
  documents: "portalDocumentsEnabled",
  calculators: "portalCalculatorsEnabled",
};

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = (await req.json().catch(() => ({}))) as {
      feature?: unknown;
      enabled?: unknown;
    };
    if (!isPortalFeatureKey(body.feature)) {
      return NextResponse.json(
        { error: "feature must be one of investments, budget, documents, calculators" },
        { status: 400 },
      );
    }
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
    }
    const feature = body.feature;
    const enabled = body.enabled;

    await db
      .update(clients)
      .set({ [COLUMN_BY_FEATURE[feature]]: enabled })
      .where(eq(clients.id, id));

    await recordAudit({
      action: "portal.feature_toggle",
      resourceType: "portal_binding",
      resourceId: id,
      clientId: id,
      firmId,
      actorKind: "advisor",
      metadata: { feature, enabled },
    });

    return NextResponse.json({ ok: true, feature, enabled });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/portal/features error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
