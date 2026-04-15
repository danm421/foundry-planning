import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, expenses } from "@/db/schema";
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

// GET /api/clients/[id]/expenses — list expenses for base case scenario
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

    const rows = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.clientId, id), eq(expenses.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/expenses error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/expenses — create expense for base case scenario
export async function POST(
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
    const { type, name, annualAmount, startYear, endYear, growthRate, ownerEntityId, cashAccountId } = body;

    if (!type || !name || !startYear || !endYear) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [expense] = await db
      .insert(expenses)
      .values({
        clientId: id,
        scenarioId,
        type,
        name,
        annualAmount: annualAmount ?? "0",
        startYear: Number(startYear),
        endYear: Number(endYear),
        growthRate: growthRate ?? "0.03",
        ownerEntityId: ownerEntityId ?? null,
        cashAccountId: cashAccountId ?? null,
      })
      .returning();

    return NextResponse.json(expense, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/expenses error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
