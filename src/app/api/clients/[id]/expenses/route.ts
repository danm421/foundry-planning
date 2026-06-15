import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, expenses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId, requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { createExpenseForClient } from "@/lib/clients/expenses-writes";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string, firmId: string): Promise<string | null> {
  if (!(await verifyClientAccess(clientId, firmId))) return null;

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
    const firmId = await requireOrgId();
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
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { id } = await params;
    const result = await createExpenseForClient({
      clientId: id,
      firmId,
      actorId: userId,
      input: await request.json(),
    });
    return result.ok
      ? NextResponse.json(result.data, { status: 201 })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/expenses error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
