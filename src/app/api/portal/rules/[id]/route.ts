import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactionRules, transactionCategories, clients } from "@/db/schema";
import { authErrorResponse, requireClientPortalAccess } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate, recordDelete } from "@/lib/audit/record-helpers";
import type { FieldLabels } from "@/lib/audit/types";
import { applyRuleRetroactively } from "@/lib/portal/recategorize";

export const dynamic = "force-dynamic";

type Body = { matchType?: string; pattern?: string; categoryId?: string; priority?: number };

const FIELD_LABELS: FieldLabels = {
  matchType: { label: "Match type", format: "text" },
  pattern: { label: "Pattern", format: "text" },
  categoryId: { label: "Category", format: "reference" },
  priority: { label: "Priority", format: "text" },
};

async function getFirmId(clientId: string): Promise<string | null> {
  const [{ firmId } = { firmId: null as string | null }] = await db
    .select({ firmId: clients.firmId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return firmId;
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Body;

    const [row] = await db.select().from(transactionRules).where(eq(transactionRules.id, id)).limit(1);
    if (!row || row.clientId !== clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const next = {
      matchType: body.matchType === "exact" || body.matchType === "contains" ? body.matchType : row.matchType,
      pattern: body.pattern?.trim() || row.pattern,
      categoryId: body.categoryId ?? row.categoryId,
      priority: typeof body.priority === "number" ? body.priority : row.priority,
    };
    if (next.categoryId !== row.categoryId) {
      const [cat] = await db
        .select({ clientId: transactionCategories.clientId, kind: transactionCategories.kind })
        .from(transactionCategories).where(eq(transactionCategories.id, next.categoryId)).limit(1);
      if (!cat || cat.clientId !== clientId || cat.kind !== "category") {
        return NextResponse.json({ error: "invalid category" }, { status: 400 });
      }
    }
    const firmId = await getFirmId(clientId);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.update(transactionRules).set({ ...next, updatedAt: new Date() }).where(eq(transactionRules.id, id));
    const applied = await applyRuleRetroactively(clientId, { id, ...next });

    await recordUpdate({
      action: "portal.rule.update", resourceType: "transaction_rule", resourceId: id,
      clientId, firmId, actorKind: "client",
      before: { matchType: row.matchType, pattern: row.pattern, categoryId: row.categoryId, priority: row.priority },
      after: next, fieldLabels: FIELD_LABELS,
    });
    return NextResponse.json({ ok: true, applied });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;
    const [row] = await db.select().from(transactionRules).where(eq(transactionRules.id, id)).limit(1);
    if (!row || row.clientId !== clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const firmId = await getFirmId(clientId);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(transactionRules).where(eq(transactionRules.id, id));
    await recordDelete({
      action: "portal.rule.delete", resourceType: "transaction_rule", resourceId: id,
      clientId, firmId, actorKind: "client",
      snapshot: { matchType: row.matchType, pattern: row.pattern, categoryId: row.categoryId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
