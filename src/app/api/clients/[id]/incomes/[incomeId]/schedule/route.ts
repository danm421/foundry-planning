import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, incomes, incomeScheduleOverrides } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; incomeId: string }> };

async function verifyOwnership(clientId: string, incomeId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return false;

  const [inc] = await db
    .select()
    .from(incomes)
    .where(and(eq(incomes.id, incomeId), eq(incomes.clientId, clientId)));
  return !!inc;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { id, incomeId } = await params;

    if (!(await verifyOwnership(id, incomeId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select({ year: incomeScheduleOverrides.year, amount: incomeScheduleOverrides.amount })
      .from(incomeScheduleOverrides)
      .where(eq(incomeScheduleOverrides.incomeId, incomeId));

    return NextResponse.json(
      rows.map((r) => ({ year: r.year, amount: parseFloat(r.amount) }))
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET income schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { id, incomeId } = await params;

    if (!(await verifyOwnership(id, incomeId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const overrides: { year: number; amount: number }[] = body.overrides ?? [];

    await db
      .delete(incomeScheduleOverrides)
      .where(eq(incomeScheduleOverrides.incomeId, incomeId));

    if (overrides.length > 0) {
      await db.insert(incomeScheduleOverrides).values(
        overrides.map((o) => ({
          incomeId,
          year: o.year,
          amount: String(o.amount),
        }))
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT income schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { id, incomeId } = await params;

    if (!(await verifyOwnership(id, incomeId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(incomeScheduleOverrides)
      .where(eq(incomeScheduleOverrides.incomeId, incomeId));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE income schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
