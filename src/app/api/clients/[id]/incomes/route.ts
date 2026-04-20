import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, incomes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { assertAccountsInClient, assertEntitiesInClient } from "@/lib/db-scoping";

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

// GET /api/clients/[id]/incomes — list incomes for base case scenario
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
      .from(incomes)
      .where(and(eq(incomes.clientId, id), eq(incomes.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/incomes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/incomes — create income for base case scenario
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
      type,
      name,
      annualAmount,
      startYear,
      endYear,
      growthRate,
      growthSource,
      owner,
      claimingAge,
      linkedEntityId,
      ownerEntityId,
      cashAccountId,
      inflationStartYear,
    } = body;
    const startYearRef = body.startYearRef ?? null;
    const endYearRef = body.endYearRef ?? null;
    const taxType = body.taxType ?? null;
    const ssBenefitMode = body.ssBenefitMode ?? null;
    const piaMonthly = body.piaMonthly != null ? String(body.piaMonthly) : null;
    const claimingAgeMonths = body.claimingAgeMonths != null ? Number(body.claimingAgeMonths) : 0;
    const claimingAgeMode = body.claimingAgeMode ?? null;

    if (!type || !name || !startYear || !endYear) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const entCheck = await assertEntitiesInClient(id, [linkedEntityId, ownerEntityId]);
    if (!entCheck.ok) {
      return NextResponse.json({ error: entCheck.reason }, { status: 400 });
    }
    const acctCheck = await assertAccountsInClient(id, [cashAccountId]);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }

    const [income] = await db
      .insert(incomes)
      .values({
        clientId: id,
        scenarioId,
        type,
        name,
        annualAmount: annualAmount ?? "0",
        startYear: Number(startYear),
        endYear: Number(endYear),
        growthRate: growthRate ?? "0.03",
        growthSource: growthSource === "inflation" ? "inflation" : "custom",
        owner: owner ?? "client",
        claimingAge: claimingAge ? Number(claimingAge) : null,
        linkedEntityId: linkedEntityId ?? null,
        ownerEntityId: ownerEntityId ?? null,
        cashAccountId: cashAccountId ?? null,
        inflationStartYear: inflationStartYear != null ? Number(inflationStartYear) : null,
        startYearRef,
        endYearRef,
        taxType,
        ssBenefitMode,
        piaMonthly,
        claimingAgeMonths,
        claimingAgeMode,
      })
      .returning();

    return NextResponse.json(income, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/incomes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
