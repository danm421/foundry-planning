import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, planSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

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

// GET /api/clients/[id]/plan-settings — get plan settings for base case
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [settings] = await db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenarioId)));

    if (!settings) {
      return NextResponse.json({ error: "No plan settings found" }, { status: 404 });
    }

    return NextResponse.json(settings);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/plan-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id]/plan-settings — update plan settings for base case
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const { flatFederalRate, flatStateRate, inflationRate, planStartYear, planEndYear } = body;

    const [updated] = await db
      .update(planSettings)
      .set({
        flatFederalRate: flatFederalRate != null ? String(flatFederalRate) : undefined,
        flatStateRate: flatStateRate != null ? String(flatStateRate) : undefined,
        inflationRate: inflationRate != null ? String(inflationRate) : undefined,
        planStartYear: planStartYear != null ? Number(planStartYear) : undefined,
        planEndYear: planEndYear != null ? Number(planEndYear) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenarioId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Plan settings not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/plan-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
