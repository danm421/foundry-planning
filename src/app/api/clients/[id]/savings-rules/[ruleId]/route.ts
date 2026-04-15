import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, savingsRules } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

async function verifyClientAccess(clientId: string, firmId: string): Promise<boolean> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

// PUT /api/clients/[id]/savings-rules/[ruleId] — update savings rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, ruleId } = await params;

    const hasAccess = await verifyClientAccess(id, firmId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const { accountId, annualAmount, startYear, endYear, employerMatchPct, employerMatchCap, annualLimit } = body;

    const [updated] = await db
      .update(savingsRules)
      .set({
        ...(accountId !== undefined && { accountId }),
        ...(annualAmount !== undefined && { annualAmount }),
        ...(startYear !== undefined && { startYear: Number(startYear) }),
        ...(endYear !== undefined && { endYear: Number(endYear) }),
        ...(employerMatchPct !== undefined && { employerMatchPct: employerMatchPct ?? null }),
        ...(employerMatchCap !== undefined && { employerMatchCap: employerMatchCap ?? null }),
        ...(annualLimit !== undefined && { annualLimit: annualLimit ?? null }),
        updatedAt: new Date(),
      })
      .where(and(eq(savingsRules.id, ruleId), eq(savingsRules.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Savings rule not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/savings-rules/[ruleId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/savings-rules/[ruleId] — delete savings rule
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, ruleId } = await params;

    const hasAccess = await verifyClientAccess(id, firmId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await db
      .delete(savingsRules)
      .where(and(eq(savingsRules.id, ruleId), eq(savingsRules.clientId, id)));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/savings-rules/[ruleId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
