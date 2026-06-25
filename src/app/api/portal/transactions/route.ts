import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaidTransactions, transactionCategories, accounts, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordCreate } from "@/lib/audit/record-helpers";
import { encodeSignedAmount } from "@/lib/portal/transaction-amount";
import {
  loadPortalTransactions,
  countPortalTransactions,
  type TransactionFilters,
} from "@/lib/portal/transactions-query";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export async function GET(req: Request): Promise<Response> {
  try {
    // Act-as aware so advisor "preview as client" reads the client's transactions.
    const { clientId } = await resolvePortalClient();
    const url = new URL(req.url);
    const qp = url.searchParams;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(qp.get("limit")) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(qp.get("offset")) || 0);
    const filters: TransactionFilters = {
      from: qp.get("from") ?? undefined,
      to: qp.get("to") ?? undefined,
      categoryId: qp.get("categoryId") ?? undefined,
      q: qp.get("q") ?? undefined,
      includeExcluded: qp.get("includeExcluded") === "true",
      reviewed: qp.get("reviewed") === null ? undefined : qp.get("reviewed") === "true",
      limit,
      offset,
    };
    const [transactions, total] = await Promise.all([
      loadPortalTransactions(clientId, filters),
      countPortalTransactions(clientId, filters),
    ]);
    return NextResponse.json({ transactions, total, hasMore: offset + transactions.length < total });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

type CreateBody = {
  date?: string;
  amount?: number | string;
  type?: "income" | "expense" | "transfer";
  name?: string;
  categoryId?: string | null;
  accountId?: string | null;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as CreateBody;

    if (!body.name || body.name.trim() === "") {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(body.date))) {
      return NextResponse.json({ error: "valid date required" }, { status: 400 });
    }
    if (body.type !== "income" && body.type !== "expense" && body.type !== "transfer") {
      return NextResponse.json({ error: "invalid type" }, { status: 400 });
    }
    const magnitude = Number(body.amount);
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
      return NextResponse.json({ error: "amount must be greater than zero" }, { status: 400 });
    }

    // Transfers never carry a category; otherwise validate the chosen leaf.
    const categoryId: string | null = body.type === "transfer" ? null : body.categoryId ?? null;
    if (categoryId !== null) {
      const [cat] = await db
        .select({ clientId: transactionCategories.clientId, kind: transactionCategories.kind })
        .from(transactionCategories)
        .where(eq(transactionCategories.id, categoryId))
        .limit(1);
      if (!cat || cat.clientId !== clientId || cat.kind !== "category") {
        return NextResponse.json({ error: "invalid category" }, { status: 400 });
      }
    }

    const accountId: string | null = body.accountId ?? null;
    if (accountId !== null) {
      const [acct] = await db
        .select({ clientId: accounts.clientId })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .limit(1);
      if (!acct || acct.clientId !== clientId) {
        return NextResponse.json({ error: "invalid account" }, { status: 400 });
      }
    }

    const [client] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!client?.firmId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const amount = encodeSignedAmount(magnitude, body.type);
    const [row] = await db
      .insert(plaidTransactions)
      .values({
        clientId,
        source: "manual",
        plaidItemId: null,
        plaidAccountId: null,
        plaidTransactionId: null,
        accountId,
        date: body.date,
        amount,
        name: body.name.trim(),
        merchantName: null,
        type: body.type,
        categoryId,
        categorizedBy: "manual",
        pending: false,
        excluded: false,
      })
      .returning({ id: plaidTransactions.id });

    await recordCreate({
      action: "portal.transaction.create",
      resourceType: "plaid_transaction",
      resourceId: row.id,
      clientId,
      firmId: client.firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: { name: body.name.trim(), date: body.date, amount, type: body.type, categoryId },
    });

    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
