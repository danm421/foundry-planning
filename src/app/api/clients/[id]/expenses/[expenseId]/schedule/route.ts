import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, expenses, expenseScheduleOverrides } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; expenseId: string }> };

async function verifyOwnership(clientId: string, expenseId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return false;

  const [exp] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, clientId)));
  return !!exp;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, expenseId } = await params;

    if (!(await verifyOwnership(id, expenseId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select({ year: expenseScheduleOverrides.year, amount: expenseScheduleOverrides.amount })
      .from(expenseScheduleOverrides)
      .where(eq(expenseScheduleOverrides.expenseId, expenseId));

    return NextResponse.json(
      rows.map((r) => ({ year: r.year, amount: parseFloat(r.amount) }))
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET expense schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, expenseId } = await params;

    if (!(await verifyOwnership(id, expenseId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const overrides: { year: number; amount: number }[] = body.overrides ?? [];

    await db
      .delete(expenseScheduleOverrides)
      .where(eq(expenseScheduleOverrides.expenseId, expenseId));

    if (overrides.length > 0) {
      await db.insert(expenseScheduleOverrides).values(
        overrides.map((o) => ({
          expenseId,
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
    console.error("PUT expense schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, expenseId } = await params;

    if (!(await verifyOwnership(id, expenseId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(expenseScheduleOverrides)
      .where(eq(expenseScheduleOverrides.expenseId, expenseId));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE expense schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
