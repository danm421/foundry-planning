import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactionCategories, plaidTransactions, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate, recordDelete } from "@/lib/audit/record-helpers";
import type { FieldLabels } from "@/lib/audit/types";

export const dynamic = "force-dynamic";

type PutBody = { name?: string; color?: string; sortOrder?: number };
type DeleteBody = { reassignToId?: string | null };

const FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  color: { label: "Color", format: "text" },
  sortOrder: { label: "Order", format: "text" },
};

async function getFirmId(clientId: string): Promise<string | null> {
  const [{ firmId } = { firmId: null as string | null }] = await db
    .select({ firmId: clients.firmId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return firmId;
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as PutBody;
    const [row] = await db.select().from(transactionCategories).where(eq(transactionCategories.id, id)).limit(1);
    if (!row || row.clientId !== clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const next = {
      name: body.name?.trim() || row.name,
      color: body.color ?? row.color,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : row.sortOrder,
    };
    const firmId = await getFirmId(clientId);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.update(transactionCategories).set({ ...next, updatedAt: new Date() }).where(eq(transactionCategories.id, id));
    await recordUpdate({
      action: "portal.category.update", resourceType: "transaction_category", resourceId: id,
      clientId, firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      before: { name: row.name, color: row.color, sortOrder: row.sortOrder },
      after: next, fieldLabels: FIELD_LABELS,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as DeleteBody;
    const [row] = await db.select().from(transactionCategories).where(eq(transactionCategories.id, id)).limit(1);
    if (!row || row.clientId !== clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.isSystem) return NextResponse.json({ error: "Default categories can't be deleted" }, { status: 400 });

    const reassignToId = body.reassignToId ?? null;
    if (reassignToId !== null) {
      const [target] = await db
        .select({ clientId: transactionCategories.clientId, kind: transactionCategories.kind })
        .from(transactionCategories).where(eq(transactionCategories.id, reassignToId)).limit(1);
      if (!target || target.clientId !== clientId || target.kind !== "category") {
        return NextResponse.json({ error: "invalid reassign target" }, { status: 400 });
      }
    }
    const firmId = await getFirmId(clientId);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.transaction(async (tx) => {
      await tx.update(plaidTransactions)
        .set({ categoryId: reassignToId, updatedAt: new Date() })
        .where(eq(plaidTransactions.categoryId, id));
      // FK on transaction_rules is ON DELETE CASCADE → rules pointing here are removed automatically.
      await tx.delete(transactionCategories).where(eq(transactionCategories.id, id));
    });

    await recordDelete({
      action: "portal.category.delete", resourceType: "transaction_category", resourceId: id,
      clientId, firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: { name: row.name, kind: row.kind, reassignedTo: reassignToId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
