import { NextRequest, NextResponse } from "next/server";
import { db } from "@foundry/db";
import { clients, savingsRules, savingsScheduleOverrides } from "@foundry/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; ruleId: string }> };

async function verifyOwnership(clientId: string, ruleId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return false;

  const [rule] = await db
    .select()
    .from(savingsRules)
    .where(and(eq(savingsRules.id, ruleId), eq(savingsRules.clientId, clientId)));
  return !!rule;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, ruleId } = await params;

    if (!(await verifyOwnership(id, ruleId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select({ year: savingsScheduleOverrides.year, amount: savingsScheduleOverrides.amount })
      .from(savingsScheduleOverrides)
      .where(eq(savingsScheduleOverrides.savingsRuleId, ruleId));

    return NextResponse.json(
      rows.map((r) => ({ year: r.year, amount: parseFloat(r.amount) }))
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET savings schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, ruleId } = await params;

    if (!(await verifyOwnership(id, ruleId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const overrides: { year: number; amount: number }[] = body.overrides ?? [];

    await db
      .delete(savingsScheduleOverrides)
      .where(eq(savingsScheduleOverrides.savingsRuleId, ruleId));

    if (overrides.length > 0) {
      await db.insert(savingsScheduleOverrides).values(
        overrides.map((o) => ({
          savingsRuleId: ruleId,
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
    console.error("PUT savings schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, ruleId } = await params;

    if (!(await verifyOwnership(id, ruleId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(savingsScheduleOverrides)
      .where(eq(savingsScheduleOverrides.savingsRuleId, ruleId));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE savings schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
