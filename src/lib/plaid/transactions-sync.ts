import type { Transaction, RemovedTransaction } from "plaid";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, plaidItems, plaidTransactions } from "@/db/schema";
import { getPlaidClient } from "./client";
import { decrypt } from "./crypto";
import { plaidErrorCode, plaidErrorMessage } from "./errors";
import { resolveTransactionCategory } from "@/lib/portal/resolve-category";
import { ensureCategoriesSeeded } from "@/lib/portal/seed-categories";
import { loadCategorizationContext } from "@/lib/portal/load-categorization-context";
import type { CategorizationContext } from "@/lib/portal/load-categorization-context";

const FIRST_SYNC_DAYS_REQUESTED = 730; // Phase 2 decision: max trend depth

export type NewPlaidTransactionRow = {
  clientId: string;
  plaidItemId: string;
  accountId: string | null;
  plaidAccountId: string;
  plaidTransactionId: string;
  amount: string;
  isoCurrencyCode: string | null;
  date: string;
  authorizedDate: string | null;
  merchantName: string | null;
  name: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  pfcConfidence: string | null;
  paymentChannel: string | null;
  pending: boolean;
  categoryId: string | null;
  categorizedBy: "plaid" | "rule" | "recurring";
  recurringTransactionId: string | null;
};

export function mapPlaidTransaction(
  clientId: string,
  plaidItemId: string,
  accountIdByPlaidAccountId: Map<string, string>,
  t: Transaction,
): NewPlaidTransactionRow {
  const pfc = t.personal_finance_category ?? null;
  return {
    clientId,
    plaidItemId,
    accountId: accountIdByPlaidAccountId.get(t.account_id) ?? null,
    plaidAccountId: t.account_id,
    plaidTransactionId: t.transaction_id,
    amount: t.amount.toFixed(2), // Plaid sign preserved: positive = money out
    isoCurrencyCode: t.iso_currency_code ?? null,
    date: t.date,
    authorizedDate: t.authorized_date ?? null,
    merchantName: t.merchant_name ?? null,
    name: t.name,
    pfcPrimary: pfc?.primary ?? null,
    pfcDetailed: pfc?.detailed ?? null,
    pfcConfidence: pfc?.confidence_level ?? null,
    paymentChannel: t.payment_channel ?? null,
    pending: t.pending,
    categorizedBy: "plaid",
    categoryId: null,
    recurringTransactionId: null,
  };
}

export type TransactionUpdates =
  | {
      ok: true;
      added: Transaction[];
      modified: Transaction[];
      removed: string[]; // transaction_ids
      nextCursor: string;
    }
  | { ok: false; errorCode: string; errorMessage: string };

/**
 * Paginates Plaid /transactions/sync to exhaustion. First sync (cursor null)
 * omits `cursor` and sets options.days_requested = 730 for trend depth.
 * Returns the accumulated added/modified/removed plus the final cursor.
 */
export async function fetchTransactionUpdates(
  item: { accessToken: string },
  cursor: string | null,
): Promise<TransactionUpdates> {
  const client = getPlaidClient();
  const access_token = decrypt(item.accessToken);
  const added: Transaction[] = [];
  const modified: Transaction[] = [];
  const removed: string[] = [];
  let nextCursor = cursor ?? undefined;
  try {
    let hasMore = true;
    while (hasMore) {
      const resp = await client.transactionsSync({
        access_token,
        cursor: nextCursor,
        options: {
          include_personal_finance_category: true,
          ...(cursor == null ? { days_requested: FIRST_SYNC_DAYS_REQUESTED } : {}),
        },
      });
      const d = resp.data;
      added.push(...d.added);
      modified.push(...d.modified);
      removed.push(...d.removed.map((r: RemovedTransaction) => r.transaction_id));
      nextCursor = d.next_cursor;
      hasMore = d.has_more;
    }
    return { ok: true, added, modified, removed, nextCursor: nextCursor! };
  } catch (err) {
    return { ok: false, errorCode: plaidErrorCode(err), errorMessage: plaidErrorMessage(err) };
  }
}

type ApplyCtx = {
  clientId: string;
  plaidItemId: string; // our plaid_items.id (uuid)
  accountIdByPlaidAccountId: Map<string, string>;
  categorization: CategorizationContext;
};

/** Upserts added+modified on plaidTransactionId; deletes removed. Idempotent. */
export async function applyTransactionUpdates(
  tx: typeof db,
  ctx: ApplyCtx,
  updates: { added: Transaction[]; modified: Transaction[]; removed: string[] },
): Promise<void> {
  const upserts = [...updates.added, ...updates.modified].map((t) => {
    const row = mapPlaidTransaction(ctx.clientId, ctx.plaidItemId, ctx.accountIdByPlaidAccountId, t);
    const resolved = resolveTransactionCategory({
      rules: ctx.categorization.rules,
      recurrings: ctx.categorization.recurrings,
      pfcPrimary: row.pfcPrimary,
      pfcDetailed: row.pfcDetailed,
      merchantName: row.merchantName,
      name: row.name,
      amount: Number(row.amount),
      date: row.date,
      slugToId: ctx.categorization.slugToId,
    });
    return {
      ...row,
      categoryId: resolved.categoryId,
      categorizedBy: resolved.categorizedBy,
      recurringTransactionId: resolved.recurringTransactionId,
    };
  });
  for (const row of upserts) {
    await tx
      .insert(plaidTransactions)
      .values(row)
      .onConflictDoUpdate({
        target: plaidTransactions.plaidTransactionId,
        set: {
          accountId: row.accountId,
          amount: row.amount,
          date: row.date,
          authorizedDate: row.authorizedDate,
          merchantName: row.merchantName,
          name: row.name,
          pfcPrimary: row.pfcPrimary,
          pfcDetailed: row.pfcDetailed,
          pfcConfidence: row.pfcConfidence,
          paymentChannel: row.paymentChannel,
          pending: row.pending,
          updatedAt: new Date(),
        },
      });
  }
  if (updates.removed.length > 0) {
    await tx
      .delete(plaidTransactions)
      .where(
        and(
          eq(plaidTransactions.clientId, ctx.clientId),
          inArray(plaidTransactions.plaidTransactionId, updates.removed),
        ),
      );
  }
}

export type SyncSummary =
  | { ok: true; added: number; modified: number; removed: number }
  | { ok: false; errorCode: string; errorMessage: string };

/**
 * Full on-demand sync for one item: load cursor + linked accounts, fetch
 * updates, apply them, persist next_cursor. The caller has already verified the
 * item belongs to the client (tenant check) and supplies the encrypted token.
 */
export async function syncTransactionsForItem(item: {
  id: string;
  clientId: string;
  accessToken: string;
  transactionsCursor: string | null;
}): Promise<SyncSummary> {
  const fetched = await fetchTransactionUpdates(
    { accessToken: item.accessToken },
    item.transactionsCursor,
  );
  if (!fetched.ok) return fetched;

  await ensureCategoriesSeeded(item.clientId);
  const categorization = await loadCategorizationContext(item.clientId);

  // Resolve our accountId for each Plaid account handle under this item.
  const linked = await db
    .select({ id: accounts.id, plaidAccountId: accounts.plaidAccountId })
    .from(accounts)
    .where(and(eq(accounts.plaidItemId, item.id), isNotNull(accounts.plaidAccountId)));
  const accountIdByPlaidAccountId = new Map<string, string>();
  for (const a of linked) if (a.plaidAccountId) accountIdByPlaidAccountId.set(a.plaidAccountId, a.id);

  await db.transaction(async (tx) => {
    await applyTransactionUpdates(tx as unknown as typeof db, {
      clientId: item.clientId,
      plaidItemId: item.id,
      accountIdByPlaidAccountId,
      categorization,
    }, fetched);
    await tx
      .update(plaidItems)
      .set({ transactionsCursor: fetched.nextCursor })
      .where(eq(plaidItems.id, item.id));
  });

  return {
    ok: true,
    added: fetched.added.length,
    modified: fetched.modified.length,
    removed: fetched.removed.length,
  };
}
