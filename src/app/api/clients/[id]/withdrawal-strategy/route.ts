import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, withdrawalStrategies } from "@/db/schema";
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

// GET /api/clients/[id]/withdrawal-strategy — list withdrawal strategies for base case scenario
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
      .from(withdrawalStrategies)
      .where(and(eq(withdrawalStrategies.clientId, id), eq(withdrawalStrategies.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/withdrawal-strategy error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/withdrawal-strategy — create withdrawal strategy for base case scenario
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
    const { accountId, priorityOrder, startYear, endYear } = body;
    const startYearRef = body.startYearRef ?? null;
    const endYearRef = body.endYearRef ?? null;

    if (!accountId || priorityOrder === undefined || !startYear || !endYear) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [strategy] = await db
      .insert(withdrawalStrategies)
      .values({
        clientId: id,
        scenarioId,
        accountId,
        priorityOrder: Number(priorityOrder),
        startYear: Number(startYear),
        endYear: Number(endYear),
        startYearRef,
        endYearRef,
      })
      .returning();

    await recordAudit({
      action: "withdrawal_strategy.create",
      resourceType: "withdrawal_strategy",
      resourceId: strategy.id,
      clientId: id,
      firmId,
      metadata: { accountId: strategy.accountId, priorityOrder: strategy.priorityOrder },
    });

    return NextResponse.json(strategy, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/withdrawal-strategy error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
