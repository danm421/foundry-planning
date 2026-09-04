import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, clientTaxAdjustments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// GET /api/clients/[id]/tax-adjustments — list tax adjustments for base case scenario
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(clientTaxAdjustments)
      .where(and(eq(clientTaxAdjustments.clientId, id), eq(clientTaxAdjustments.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/tax-adjustments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/tax-adjustments — create tax adjustment for base case scenario
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      taxType,
      name,
      owner,
      annualAmount,
      growthRate,
      startYear,
      endYear,
      startYearRef,
      endYearRef,
      withheldMode,
      withheldValue,
    } = body;

    if (!taxType || typeof startYear !== "number" || typeof endYear !== "number") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if ((withheldMode != null) !== (withheldValue != null)) {
      return NextResponse.json(
        { error: "withheldMode and withheldValue must be sent together" },
        { status: 400 },
      );
    }
    if (withheldMode === "percent" && (withheldValue < 0 || withheldValue > 1)) {
      return NextResponse.json(
        { error: "withheldValue must be a 0..1 fraction" },
        { status: 400 },
      );
    }

    const [created] = await db
      .insert(clientTaxAdjustments)
      .values({
        clientId: id,
        scenarioId,
        taxType,
        name: name ?? null,
        owner: owner ?? "joint",
        annualAmount: annualAmount != null ? String(annualAmount) : "0",
        growthRate: growthRate != null ? String(growthRate) : "0",
        startYear,
        endYear,
        startYearRef: startYearRef ?? null,
        endYearRef: endYearRef ?? null,
        withheldMode: withheldMode ?? "none",
        withheldValue: withheldValue != null ? String(withheldValue) : "0",
      })
      .returning();

    await recordAudit({
      action: "tax_adjustment.create",
      resourceType: "tax_adjustment",
      resourceId: created.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { taxType: created.taxType, name: created.name ?? null }),
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/tax-adjustments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
