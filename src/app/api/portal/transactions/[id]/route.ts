import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaidTransactions, transactionCategories, clients, recurringTransactions, accounts } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate, recordDelete } from "@/lib/audit/record-helpers";
import { encodeSignedAmount } from "@/lib/portal/transaction-amount";
import type { EntitySnapshot, FieldLabels } from "@/lib/audit/types";

export const dynamic = "force-dynamic";

type Body = {
  categoryId?: string | null;
  excluded?: boolean;
  recurringTransactionId?: string | null;
  type?: "income" | "expense" | "transfer";
  // manual-only edits
  date?: string;
  amount?: number | string;
  name?: string;
  accountId?: string | null;
};

const FIELD_LABELS: FieldLabels = {
  categoryId: { label: "Category", format: "reference" },
  excluded: { label: "Excluded", format: "text" },
  recurringTransactionId: { label: "Recurring", format: "reference" },
  type: { label: "Type", format: "text" },
  date: { label: "Date", format: "text" },
  amount: { label: "Amount", format: "text" },
  name: { label: "Description", format: "text" },
  accountId: { label: "Account", format: "reference" },
};

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
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
        type: plaidTransactions.type,
        source: plaidTransactions.source,
        amount: plaidTransactions.amount,
        date: plaidTransactions.date,
        name: plaidTransactions.name,
        accountId: plaidTransactions.accountId,
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

    if ("type" in body && body.type != null) {
      if (body.type !== "income" && body.type !== "expense" && body.type !== "transfer") {
        return NextResponse.json({ error: "invalid type" }, { status: 400 });
      }
      patch.type = body.type;
      before.type = row.type;
      after.type = body.type;
      if (body.type === "transfer") {
        // Internal transfers carry no category and never count toward budgets.
        patch.categoryId = null;
        patch.categorizedBy = "manual";
        before.categoryId = row.categoryId;
        after.categoryId = null;
      }
    }

    const isManual = row.source === "manual";

    // Synced rows are immutable except category/type/exclude/recurring.
    if (!isManual && ("date" in body || "amount" in body || "name" in body || "accountId" in body)) {
      return NextResponse.json(
        { error: "Synced transactions can't have their amount, date, or description edited" },
        { status: 400 },
      );
    }

    if (isManual && "name" in body) {
      if (!body.name || body.name.trim() === "") {
        return NextResponse.json({ error: "name required" }, { status: 400 });
      }
      patch.name = body.name.trim();
      before.name = row.name;
      after.name = body.name.trim();
    }

    if (isManual && "date" in body) {
      if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(body.date))) {
        return NextResponse.json({ error: "valid date required" }, { status: 400 });
      }
      patch.date = body.date;
      before.date = row.date;
      after.date = body.date;
    }

    if (isManual && "accountId" in body) {
      const next = body.accountId ?? null;
      if (next !== null) {
        const [acct] = await db
          .select({ clientId: accounts.clientId })
          .from(accounts)
          .where(eq(accounts.id, next))
          .limit(1);
        if (!acct || acct.clientId !== clientId) {
          return NextResponse.json({ error: "invalid account" }, { status: 400 });
        }
      }
      patch.accountId = next;
      before.accountId = row.accountId;
      after.accountId = next;
    }

    // A manual row's stored sign encodes its type, so re-encode whenever the
    // magnitude OR the type changes. effectiveType = the new type if present.
    if (isManual && ("amount" in body || "type" in body)) {
      const effectiveType = ("type" in body && body.type ? body.type : row.type) as
        "income" | "expense" | "transfer";
      const magnitude = "amount" in body ? Number(body.amount) : Math.abs(Number(row.amount));
      if (!Number.isFinite(magnitude) || magnitude <= 0) {
        return NextResponse.json({ error: "amount must be greater than zero" }, { status: 400 });
      }
      const signed = encodeSignedAmount(magnitude, effectiveType);
      patch.amount = signed;
      before.amount = row.amount;
      after.amount = signed;
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
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
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

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;

    const [row] = await db
      .select({
        id: plaidTransactions.id,
        clientId: plaidTransactions.clientId,
        source: plaidTransactions.source,
        name: plaidTransactions.name,
        amount: plaidTransactions.amount,
        date: plaidTransactions.date,
      })
      .from(plaidTransactions)
      .where(eq(plaidTransactions.id, id))
      .limit(1);
    if (!row || row.clientId !== clientId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (row.source !== "manual") {
      return NextResponse.json({ error: "Synced transactions can't be deleted" }, { status: 400 });
    }

    const [{ firmId } = { firmId: null as string | null }] = await db
      .select({ firmId: clients.firmId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(plaidTransactions).where(eq(plaidTransactions.id, id));

    await recordDelete({
      action: "portal.transaction.delete",
      resourceType: "plaid_transaction",
      resourceId: id,
      clientId,
      firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: { name: row.name, amount: row.amount, date: row.date },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
