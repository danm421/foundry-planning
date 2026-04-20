import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, liabilities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
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

// GET /api/clients/[id]/liabilities — list liabilities for base case scenario
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
      .from(liabilities)
      .where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/liabilities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/liabilities — create liability
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
    const {
      name,
      balance,
      interestRate,
      monthlyPayment,
      startYear,
      startMonth,
      termMonths,
      termUnit,
      balanceAsOfMonth,
      balanceAsOfYear,
      linkedPropertyId,
      ownerEntityId,
    } = body;
    const startYearRef = body.startYearRef ?? null;

    if (!name || startYear == null || termMonths == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const entCheck = await assertEntitiesInClient(id, [ownerEntityId]);
    if (!entCheck.ok) {
      return NextResponse.json({ error: entCheck.reason }, { status: 400 });
    }
    // linkedPropertyId is an account id (real-estate account) — ensure it
     // belongs to this client before linking.
    const acctCheck = await assertAccountsInClient(id, [linkedPropertyId]);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }

    const [liability] = await db
      .insert(liabilities)
      .values({
        clientId: id,
        scenarioId,
        name,
        balance: balance ?? "0",
        interestRate: interestRate ?? "0",
        monthlyPayment: monthlyPayment ?? "0",
        startYear: Number(startYear),
        startMonth: startMonth != null ? Number(startMonth) : 1,
        termMonths: Number(termMonths),
        termUnit: termUnit ?? "annual",
        balanceAsOfMonth: balanceAsOfMonth != null ? Number(balanceAsOfMonth) : null,
        balanceAsOfYear: balanceAsOfYear != null ? Number(balanceAsOfYear) : null,
        linkedPropertyId: linkedPropertyId ?? null,
        ownerEntityId: ownerEntityId ?? null,
        startYearRef,
        isInterestDeductible: body.isInterestDeductible ?? false,
      })
      .returning();

    return NextResponse.json(liability, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/liabilities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
