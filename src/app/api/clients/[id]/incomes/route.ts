import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, incomes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { createIncomeForClient } from "@/lib/clients/incomes-writes";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string): Promise<string | null> {
  const access = await verifyClientAccess(clientId);
  if (!access.ok) return null;

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
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id);
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
    const { id } = await params;
    const { userId, orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const result = await createIncomeForClient({
      clientId: id,
      firmId,
      actorId: userId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data, { status: 201 })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/incomes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
