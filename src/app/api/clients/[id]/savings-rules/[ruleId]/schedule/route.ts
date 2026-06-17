import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { savingsRules, savingsScheduleOverrides } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; ruleId: string }> };

async function verifyOwnership(clientId: string, ruleId: string) {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return false;

  const [rule] = await db
    .select()
    .from(savingsRules)
    .where(and(eq(savingsRules.id, ruleId), eq(savingsRules.clientId, clientId)));
  return !!rule;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id, ruleId } = await params;

    if (!(await verifyOwnership(id, ruleId))) {
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
    const { id, ruleId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    if (!(await verifyOwnership(id, ruleId))) {
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

    await recordAudit({
      action: "savings_rule.schedule.update",
      resourceType: "savings_rule",
      resourceId: ruleId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { count: overrides.length }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT savings schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id, ruleId } = await params;
    await requireOrgId();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    if (!(await verifyOwnership(id, ruleId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(savingsScheduleOverrides)
      .where(eq(savingsScheduleOverrides.savingsRuleId, ruleId));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE savings schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
