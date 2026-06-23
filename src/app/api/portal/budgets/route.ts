// src/app/api/portal/budgets/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { budgets, transactionCategories, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate } from "@/lib/audit/record-helpers";
import type { EntitySnapshot, FieldLabels } from "@/lib/audit/types";

export const dynamic = "force-dynamic";

const INCOME_GROUP_SLUG = "income";

const FIELD_LABELS: FieldLabels = {
  monthlyAmount: { label: "Monthly budget", format: "text" },
};

type Body = { categoryId?: string; monthlyAmount?: number | null };

export async function PUT(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.categoryId) {
      return NextResponse.json({ error: "categoryId required" }, { status: 400 });
    }

    // The category must belong to this client...
    const [cat] = await db
      .select({
        id: transactionCategories.id,
        clientId: transactionCategories.clientId,
        parentId: transactionCategories.parentId,
        slug: transactionCategories.slug,
      })
      .from(transactionCategories)
      .where(eq(transactionCategories.id, body.categoryId))
      .limit(1);
    if (!cat || cat.clientId !== clientId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ...and must not be in the income group (expenses-only).
    let groupSlug = cat.slug;
    if (cat.parentId) {
      const [parent] = await db
        .select({ slug: transactionCategories.slug })
        .from(transactionCategories)
        .where(eq(transactionCategories.id, cat.parentId))
        .limit(1);
      groupSlug = parent?.slug ?? null;
    }
    if (groupSlug === INCOME_GROUP_SLUG) {
      return NextResponse.json(
        { error: "Income categories can't be budgeted" },
        { status: 400 },
      );
    }

    const [{ firmId } = { firmId: null as string | null }] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [existing] = await db
      .select({ monthlyAmount: budgets.monthlyAmount })
      .from(budgets)
      .where(eq(budgets.categoryId, body.categoryId))
      .limit(1);
    const before: EntitySnapshot = {
      monthlyAmount: existing ? existing.monthlyAmount : null,
    };

    const amount = body.monthlyAmount;
    const auditBase = {
      action: "portal.budget.update" as const,
      resourceType: "budget",
      resourceId: body.categoryId,
      clientId,
      firmId,
      actorKind: mode === "advisor" ? ("advisor" as const) : ("client" as const),
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      fieldLabels: FIELD_LABELS,
    };

    if (amount == null || !Number.isFinite(amount) || amount <= 0) {
      if (existing) {
        await db.delete(budgets).where(eq(budgets.categoryId, body.categoryId));
      }
      await recordUpdate({ ...auditBase, before, after: { monthlyAmount: null } });
      return NextResponse.json({ ok: true, cleared: true });
    }

    const value = amount.toFixed(2);
    await db
      .insert(budgets)
      .values({ clientId, categoryId: body.categoryId, monthlyAmount: value })
      .onConflictDoUpdate({
        target: budgets.categoryId,
        set: { monthlyAmount: value, updatedAt: new Date() },
      });

    await recordUpdate({ ...auditBase, before, after: { monthlyAmount: value } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
