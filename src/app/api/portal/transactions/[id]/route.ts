import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaidTransactions, transactionCategories, clients, recurringTransactions } from "@/db/schema";
import { authErrorResponse, requireClientPortalAccess } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate } from "@/lib/audit/record-helpers";
import type { EntitySnapshot, FieldLabels } from "@/lib/audit/types";

export const dynamic = "force-dynamic";

type Body = { categoryId?: string | null; excluded?: boolean; recurringTransactionId?: string | null };

const FIELD_LABELS: FieldLabels = {
  categoryId: { label: "Category", format: "reference" },
  excluded: { label: "Excluded", format: "text" },
  recurringTransactionId: { label: "Recurring", format: "reference" },
};

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Body;

    const [row] = await db
      .select({
        id: plaidTransactions.id,
        clientId: plaidTransactions.clientId,
        categoryId: plaidTransactions.categoryId,
        categorizedBy: plaidTransactions.categorizedBy,
        excluded: plaidTransactions.excluded,
        recurringTransactionId: plaidTransactions.recurringTransactionId,
      })
      .from(plaidTransactions)
      .where(eq(plaidTransactions.id, id))
      .limit(1);
    if (!row || row.clientId !== clientId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    const before: EntitySnapshot = {};
    const after: EntitySnapshot = {};

    if ("categoryId" in body) {
      const next = body.categoryId ?? null;
      if (next !== null) {
        const [cat] = await db
          .select({ id: transactionCategories.id, clientId: transactionCategories.clientId, kind: transactionCategories.kind })
          .from(transactionCategories)
          .where(eq(transactionCategories.id, next))
          .limit(1);
        if (!cat || cat.clientId !== clientId || cat.kind !== "category") {
          return NextResponse.json({ error: "invalid category" }, { status: 400 });
        }
      }
      patch.categoryId = next;
      patch.categorizedBy = "manual";
      before.categoryId = row.categoryId;
      after.categoryId = next;
    }
    if ("excluded" in body && typeof body.excluded === "boolean") {
      patch.excluded = body.excluded;
      before.excluded = row.excluded;
      after.excluded = body.excluded;
    }
    if ("recurringTransactionId" in body) {
      const next = body.recurringTransactionId ?? null;
      if (next !== null) {
        const [rec] = await db
          .select({ clientId: recurringTransactions.clientId, categoryId: recurringTransactions.categoryId })
          .from(recurringTransactions)
          .where(eq(recurringTransactions.id, next))
          .limit(1);
        if (!rec || rec.clientId !== clientId) {
          return NextResponse.json({ error: "invalid recurring" }, { status: 400 });
        }
        // Manual link also files the tx under the recurring's category.
        patch.categoryId = rec.categoryId;
        patch.categorizedBy = "recurring";
        after.categoryId = rec.categoryId;
        before.categoryId = row.categoryId;
      } else {
        // Explicit unlink is a manual decision; reset provenance but keep the existing category.
        patch.categorizedBy = "manual";
      }
      patch.recurringTransactionId = next;
      before.recurringTransactionId = row.recurringTransactionId;
      after.recurringTransactionId = next;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    patch.updatedAt = new Date();

    const [{ firmId } = { firmId: null as string | null }] = await db
      .select({ firmId: clients.firmId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.update(plaidTransactions).set(patch).where(eq(plaidTransactions.id, id));

    await recordUpdate({
      action: "portal.transaction.update",
      resourceType: "plaid_transaction",
      resourceId: id,
      clientId,
      firmId,
      actorKind: "client",
      before,
      after,
      fieldLabels: FIELD_LABELS,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
