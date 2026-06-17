import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, accounts } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// POST /api/clients/[id]/reset-account-growth
// Resets all investable accounts (taxable/cash/retirement) for the base-case
// scenario to growth_source='default' and clears any custom portfolio / rate /
// realization overrides so they inherit the category defaults from plan_settings.
// Non-investable accounts (real estate, business, life insurance) use a flat
// growth rate that isn't controlled by this form, so we don't touch them.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));
    if (!scenario) {
      return NextResponse.json({ error: "No base case scenario found" }, { status: 404 });
    }

    const result = await db
      .update(accounts)
      .set({
        growthSource: "default",
        modelPortfolioId: null,
        growthRate: null,
        turnoverPct: "0",
        overridePctOi: null,
        overridePctLtCg: null,
        overridePctQdiv: null,
        overridePctTaxExempt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.scenarioId, scenario.id),
          inArray(accounts.category, ["taxable", "cash", "retirement"])
        )
      )
      .returning({ id: accounts.id });

    await recordAudit({
      action: "account.reset_growth",
      resourceType: "account",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { resetCount: result.length, scenarioId: scenario.id }),
    });

    return NextResponse.json({ resetCount: result.length });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/reset-account-growth error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
