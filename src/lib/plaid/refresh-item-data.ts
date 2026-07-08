import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, liabilities, plaidItems } from "@/db/schema";
import { fetchBalancesForItem } from "./refresh";
import { fetchLiabilitiesForItem } from "./liabilities-refresh";
import { fetchInvestmentHoldingsForItem } from "./holdings-refresh";
import { ingestHoldingsForItem } from "./ingest-holdings";
import { REAUTH_CODES } from "./errors";

export type RefreshItemDataResult =
  | { ok: true; accountsRefreshed: number; beforeTotal: string; afterTotal: string }
  | { ok: false; errorCode: string; needsReauth: boolean };

/**
 * Fetches fresh balances / liability metadata / holdings for one item and
 * persists them — the full write path behind the portal Refresh button,
 * shared with webhook-driven background refreshes. Failure persists the
 * error CODE to last_refresh_error; success clears it and stamps
 * lastRefreshedAt. Liabilities/holdings/snapshot errors never roll back the
 * committed balance updates (see try-blocks). Callers own auth + audit.
 */
export async function refreshPlaidItemData(item: {
  id: string;
  accessToken: string;
}): Promise<RefreshItemDataResult> {
  // Load only accounts linked to this specific item (tenant-scoped by plaidItemId = item row id).
  const linked = await db
    .select({
      id: accounts.id,
      plaidAccountId: accounts.plaidAccountId,
      value: accounts.value,
    })
    .from(accounts)
    .where(eq(accounts.plaidItemId, item.id))
    .limit(500);

  const linkedIds = linked
    .map((a) => a.plaidAccountId!)
    .filter((s): s is string => Boolean(s));

  const refresh = await fetchBalancesForItem(
    { accessToken: item.accessToken },
    linkedIds,
  );

  if (!refresh.ok) {
    // Write the error code to the item row; do NOT audit.
    await db
      .update(plaidItems)
      .set({ lastRefreshError: refresh.errorCode })
      .where(eq(plaidItems.id, item.id));
    return {
      ok: false,
      errorCode: refresh.errorCode,
      needsReauth: REAUTH_CODES.has(refresh.errorCode),
    };
  }

  const updateByPlaid = new Map(
    refresh.updates.map((u: { plaidAccountId: string; newValue: string }) => [
      u.plaidAccountId,
      u.newValue,
    ]),
  );

  const beforeTotal = linked.reduce((s, a) => s + Number(a.value), 0);
  let afterTotal = 0;

  await db.transaction(async (tx) => {
    for (const a of linked) {
      if (!a.plaidAccountId) continue;
      const nv = updateByPlaid.get(a.plaidAccountId);
      if (nv == null) {
        afterTotal += Number(a.value);
        continue;
      }
      await tx
        .update(accounts)
        .set({ value: nv })
        .where(eq(accounts.id, a.id));
      afterTotal += Number(nv);
    }
    await tx
      .update(plaidItems)
      .set({ lastRefreshedAt: new Date(), lastRefreshError: null })
      .where(eq(plaidItems.id, item.id));
  });

  // Refresh liability metadata (statement balance, min payment, APR, due date).
  // Runs outside the balance transaction so a Plaid Liabilities-product error
  // cannot roll back the already-committed balance updates.
  try {
    const liabResult = await fetchLiabilitiesForItem({ accessToken: item.accessToken });
    if (liabResult.ok) {
      for (const u of liabResult.updates) {
        await db
          .update(liabilities)
          .set({
            balance: u.balance,
            statementBalance: u.statementBalance,
            minimumPayment: u.minimumPayment,
            aprPercentage: u.aprPercentage,
            nextPaymentDueDate: u.nextPaymentDueDate,
          })
          .where(
            and(
              eq(liabilities.plaidItemId, item.id),
              eq(liabilities.plaidAccountId, u.plaidAccountId),
            ),
          );
      }
    }
  } catch (e) {
    // Item may not carry the Liabilities product; balance refresh already succeeded.
    console.error("portal plaid liability refresh error:", e);
  }

  // Pull investment holdings into account_holdings (single source of truth),
  // then re-derive value/basis/asset-mix. Outside the balance txn — a Plaid
  // Investments-product error cannot roll back the committed balance updates.
  try {
    const holdingsResult = await fetchInvestmentHoldingsForItem(
      { accessToken: item.accessToken },
      linkedIds,
    );
    if (holdingsResult.ok && holdingsResult.holdings.length > 0) {
      await ingestHoldingsForItem(item.id, holdingsResult.holdings);
    }
  } catch (e) {
    console.error("portal plaid holdings ingestion error:", e);
  }

  // Seed today's snapshot for this item's accounts (idempotent upsert).
  // Runs after holdings ingestion so the snapshot reflects the freshest data.
  try {
    const linkedAccountIds = linked.map((a) => a.id);
    const today = new Date().toISOString().slice(0, 10);
    const { snapshotInvestmentValues } = await import("@/lib/investments/value-snapshots");
    await snapshotInvestmentValues(linkedAccountIds, today);
  } catch (e) {
    console.error("portal plaid snapshot error:", e);
  }

  return {
    ok: true,
    accountsRefreshed: refresh.updates.length,
    beforeTotal: beforeTotal.toFixed(2),
    afterTotal: afterTotal.toFixed(2),
  };
}
