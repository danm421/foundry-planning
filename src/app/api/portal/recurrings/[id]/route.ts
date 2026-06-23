import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recurringTransactions, transactionCategories, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate, recordDelete } from "@/lib/audit/record-helpers";
import type { EntitySnapshot, FieldLabels } from "@/lib/audit/types";
import { claimRecurringRetroactively, unclaimRecurring } from "@/lib/portal/claim-recurring";

export const dynamic = "force-dynamic";

const FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  pattern: { label: "Match pattern", format: "text" },
  amountMin: { label: "Min amount", format: "text" },
  amountMax: { label: "Max amount", format: "text" },
  cadence: { label: "Cadence", format: "text" },
  categoryId: { label: "Category", format: "reference" },
};

type Body = {
  name?: string;
  matchType?: string;
  pattern?: string;
  amountMin?: number;
  amountMax?: number;
  cadence?: string;
  dueDay?: number | null;
  dueMonth?: number | null;
  categoryId?: string;
};

async function loadOwned(clientId: string, id: string) {
  const [row] = await db
    .select()
    .from(recurringTransactions)
    .where(eq(recurringTransactions.id, id))
    .limit(1);
  if (!row || row.clientId !== clientId) return null;
  return row;
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;
    const existing = await loadOwned(clientId, id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as Body;

    // Validate the (optional) new category.
    if (body.categoryId && body.categoryId !== existing.categoryId) {
      const [cat] = await db
        .select({ clientId: transactionCategories.clientId, kind: transactionCategories.kind })
        .from(transactionCategories)
        .where(eq(transactionCategories.id, body.categoryId))
        .limit(1);
      if (!cat || cat.clientId !== clientId || cat.kind !== "category") {
        return NextResponse.json({ error: "invalid category" }, { status: 400 });
      }
    }

    const next = {
      name: body.name?.trim() ?? existing.name,
      matchType: body.matchType === "exact" || body.matchType === "contains" ? body.matchType : existing.matchType,
      pattern: body.pattern?.trim() ?? existing.pattern,
      amountMin: Number.isFinite(Number(body.amountMin)) ? Number(body.amountMin).toFixed(2) : existing.amountMin,
      amountMax: Number.isFinite(Number(body.amountMax)) ? Number(body.amountMax).toFixed(2) : existing.amountMax,
      cadence: body.cadence === "monthly" || body.cadence === "annually" ? body.cadence : existing.cadence,
      dueDay: body.dueDay === undefined ? existing.dueDay : body.dueDay,
      dueMonth: body.dueMonth === undefined ? existing.dueMonth : body.dueMonth,
      categoryId: body.categoryId ?? existing.categoryId,
    };

    const [{ firmId } = { firmId: null as string | null }] = await db
      .select({ firmId: clients.firmId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db
      .update(recurringTransactions)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(recurringTransactions.id, id));

    // Re-claim: unclaim then re-apply with the new criteria.
    await unclaimRecurring(clientId, id);
    const claimed = await claimRecurringRetroactively(clientId, {
      id, matchType: next.matchType, pattern: next.pattern,
      amountMin: Number(next.amountMin), amountMax: Number(next.amountMax), categoryId: next.categoryId,
    });

    const before: EntitySnapshot = {
      name: existing.name, pattern: existing.pattern, amountMin: existing.amountMin,
      amountMax: existing.amountMax, cadence: existing.cadence, categoryId: existing.categoryId,
    };
    const after: EntitySnapshot = {
      name: next.name, pattern: next.pattern, amountMin: next.amountMin,
      amountMax: next.amountMax, cadence: next.cadence, categoryId: next.categoryId,
    };
    await recordUpdate({
      action: "portal.recurring.update",
      resourceType: "recurring_transaction",
      resourceId: id,
      clientId, firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      before, after, fieldLabels: FIELD_LABELS,
    });

    return NextResponse.json({ ok: true, claimed });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;
    const existing = await loadOwned(clientId, id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [{ firmId } = { firmId: null as string | null }] = await db
      .select({ firmId: clients.firmId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // FK ON DELETE SET NULL unclaims its transactions automatically.
    await db.delete(recurringTransactions).where(eq(recurringTransactions.id, id));

    await recordDelete({
      action: "portal.recurring.delete",
      resourceType: "recurring_transaction",
      resourceId: id,
      clientId, firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: { name: existing.name, pattern: existing.pattern, cadence: existing.cadence },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
