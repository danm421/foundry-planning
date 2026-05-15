import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, savingsRules } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string, firmId: string): Promise<string | null> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

  if (!client) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// GET /api/clients/[id]/savings-rules — list savings rules for base case scenario
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(savingsRules)
      .where(and(eq(savingsRules.clientId, id), eq(savingsRules.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/savings-rules error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/savings-rules — create savings rule for base case scenario
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      accountId,
      annualAmount,
      annualPercent,
      rothPercent,
      isDeductible,
      applyContributionLimit,
      contributeMax,
      startYear,
      endYear,
      growthRate,
      growthSource,
      employerMatchPct,
      employerMatchCap,
      employerMatchAmount,
    } = body;
    const startYearRef = body.startYearRef ?? null;
    const endYearRef = body.endYearRef ?? null;

    if (!accountId || !startYear || !endYear) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [rule] = await db
      .insert(savingsRules)
      .values({
        clientId: id,
        scenarioId,
        accountId,
        annualAmount: annualAmount ?? "0",
        annualPercent: annualPercent ?? null,
        rothPercent: rothPercent != null ? String(rothPercent) : null,
        isDeductible: isDeductible ?? true,
        applyContributionLimit: applyContributionLimit ?? true,
        contributeMax: contributeMax ?? false,
        startYear: Number(startYear),
        endYear: Number(endYear),
        growthRate: growthRate != null ? String(growthRate) : undefined,
        growthSource: growthSource === "inflation" ? "inflation" : "custom",
        employerMatchPct: employerMatchPct ?? null,
        employerMatchCap: employerMatchCap ?? null,
        employerMatchAmount: employerMatchAmount ?? null,
        startYearRef,
        endYearRef,
      })
      .returning();

    await recordAudit({
      action: "savings_rule.create",
      resourceType: "savings_rule",
      resourceId: rule.id,
      clientId: id,
      firmId,
      metadata: { accountId: rule.accountId },
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/savings-rules error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
