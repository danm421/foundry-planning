import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { transactionRules, transactionCategories, clients } from "@/db/schema";
import { authErrorResponse, requireClientPortalAccess } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordCreate } from "@/lib/audit/record-helpers";
import { applyRuleRetroactively } from "@/lib/portal/recategorize";

export const dynamic = "force-dynamic";

type Body = { matchType?: string; pattern?: string; categoryId?: string; priority?: number };

export async function GET(): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    const rules = await db
      .select()
      .from(transactionRules)
      .where(eq(transactionRules.clientId, clientId))
      .orderBy(transactionRules.priority, desc(transactionRules.createdAt));
    return NextResponse.json({ rules });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const body = (await req.json().catch(() => ({}))) as Body;
    if (body.matchType !== "exact" && body.matchType !== "contains") {
      return NextResponse.json({ error: "invalid matchType" }, { status: 400 });
    }
    if (!body.pattern || !body.pattern.trim()) {
      return NextResponse.json({ error: "pattern required" }, { status: 400 });
    }
    if (!body.categoryId) {
      return NextResponse.json({ error: "categoryId required" }, { status: 400 });
    }
    const [cat] = await db
      .select({ clientId: transactionCategories.clientId, kind: transactionCategories.kind })
      .from(transactionCategories)
      .where(eq(transactionCategories.id, body.categoryId))
      .limit(1);
    if (!cat || cat.clientId !== clientId || cat.kind !== "category") {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    const [{ firmId } = { firmId: null as string | null }] = await db
      .select({ firmId: clients.firmId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [row] = await db
      .insert(transactionRules)
      .values({
        clientId,
        matchType: body.matchType,
        pattern: body.pattern.trim(),
        categoryId: body.categoryId,
        priority: typeof body.priority === "number" ? body.priority : 100,
      })
      .returning({ id: transactionRules.id });

    const applied = await applyRuleRetroactively(clientId, {
      id: row.id, matchType: body.matchType, pattern: body.pattern.trim(), categoryId: body.categoryId,
    });

    await recordCreate({
      action: "portal.rule.create",
      resourceType: "transaction_rule",
      resourceId: row.id,
      clientId, firmId, actorKind: "client",
      snapshot: { matchType: body.matchType, pattern: body.pattern.trim(), categoryId: body.categoryId, applied },
    });

    return NextResponse.json({ id: row.id, applied });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
