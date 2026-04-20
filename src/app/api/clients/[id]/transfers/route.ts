import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, transfers, transferSchedules } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { assertAccountsInClient } from "@/lib/db-scoping";

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

// GET /api/clients/[id]/transfers — list transfers for base case scenario with schedules
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
      .from(transfers)
      .where(and(eq(transfers.clientId, id), eq(transfers.scenarioId, scenarioId)));

    let scheduleRows: (typeof transferSchedules.$inferSelect)[] = [];
    if (rows.length > 0) {
      const transferIds = rows.map((r) => r.id);
      scheduleRows = await db
        .select()
        .from(transferSchedules)
        .where(inArray(transferSchedules.transferId, transferIds));
    }

    const result = rows.map((r) => ({
      ...r,
      schedules: scheduleRows.filter((s) => s.transferId === r.id),
    }));

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/transfers error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/transfers — create transfer for base case scenario
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
      name,
      sourceAccountId,
      targetAccountId,
      startYear,
      amount,
      mode,
      startYearRef,
      endYear,
      endYearRef,
      growthRate,
      schedules,
    } = body;

    if (!name || !sourceAccountId || !targetAccountId || typeof startYear !== "number") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const acctCheck = await assertAccountsInClient(id, [sourceAccountId, targetAccountId]);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }

    const [created] = await db
      .insert(transfers)
      .values({
        clientId: id,
        scenarioId,
        name,
        sourceAccountId,
        targetAccountId,
        startYear,
        amount: amount != null ? String(amount) : "0",
        mode: mode ?? "one_time",
        startYearRef: startYearRef ?? null,
        endYear: endYear ?? null,
        endYearRef: endYearRef ?? null,
        growthRate: growthRate != null ? String(growthRate) : "0",
      })
      .returning();

    if (Array.isArray(schedules) && schedules.length > 0) {
      await db.insert(transferSchedules).values(
        schedules.map((s: { year: number; amount: number }) => ({
          transferId: created.id,
          year: s.year,
          amount: String(s.amount),
        }))
      );
    }

    const insertedSchedules = await db
      .select()
      .from(transferSchedules)
      .where(eq(transferSchedules.transferId, created.id));

    return NextResponse.json({ ...created, schedules: insertedSchedules }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/transfers error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id]/transfers — update transfer by transferId (in body)
export async function PUT(
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
      transferId,
      name,
      sourceAccountId,
      targetAccountId,
      startYear,
      amount,
      mode,
      startYearRef,
      endYear,
      endYearRef,
      growthRate,
      schedules,
    } = body;

    if (!transferId) {
      return NextResponse.json({ error: "Missing transferId" }, { status: 400 });
    }

    const acctCheck = await assertAccountsInClient(id, [sourceAccountId, targetAccountId]);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }

    const [updated] = await db
      .update(transfers)
      .set({
        ...(name !== undefined && { name }),
        ...(sourceAccountId !== undefined && { sourceAccountId }),
        ...(targetAccountId !== undefined && { targetAccountId }),
        ...(startYear !== undefined && { startYear }),
        ...(amount !== undefined && { amount: String(amount) }),
        ...(mode !== undefined && { mode }),
        ...(startYearRef !== undefined && { startYearRef: startYearRef ?? null }),
        ...(endYear !== undefined && { endYear: endYear ?? null }),
        ...(endYearRef !== undefined && { endYearRef: endYearRef ?? null }),
        ...(growthRate !== undefined && { growthRate: String(growthRate) }),
        updatedAt: new Date(),
      })
      .where(and(eq(transfers.id, transferId), eq(transfers.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    if (Array.isArray(schedules)) {
      await db
        .delete(transferSchedules)
        .where(eq(transferSchedules.transferId, transferId));

      if (schedules.length > 0) {
        await db.insert(transferSchedules).values(
          schedules.map((s: { year: number; amount: number }) => ({
            transferId,
            year: s.year,
            amount: String(s.amount),
          }))
        );
      }
    }

    const updatedSchedules = await db
      .select()
      .from(transferSchedules)
      .where(eq(transferSchedules.transferId, transferId));

    return NextResponse.json({ ...updated, schedules: updatedSchedules });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/transfers error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/transfers — delete transfer by transferId (in query params)
export async function DELETE(
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

    const { searchParams } = new URL(request.url);
    const transferId = searchParams.get("transferId");

    if (!transferId) {
      return NextResponse.json({ error: "Missing transferId" }, { status: 400 });
    }

    await db
      .delete(transfers)
      .where(and(eq(transfers.id, transferId), eq(transfers.clientId, id)));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/transfers error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
