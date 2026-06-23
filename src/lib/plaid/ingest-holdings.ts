// src/lib/plaid/ingest-holdings.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, accountHoldings } from "@/db/schema";
import { ensureSecurityForTicker } from "@/lib/investments/ensure-security";
import { holdingMarketValue } from "@/lib/investments/holdings-rollup";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";
import type { IngestHolding } from "./holdings-refresh";

/**
 * Persist fetched Plaid positions into account_holdings (one source of truth),
 * then re-derive each account's value/basis/asset-mix. Replaces source='plaid'
 * rows wholesale; manual rows are never touched. Tickered holdings store
 * marketValue=null (derive shares×price so the daily price refresh + live quotes
 * flow through); untickered holdings store the authoritative institution_value.
 */
export async function ingestHoldingsForItem(
  plaidItemRowId: string,
  holdings: IngestHolding[],
): Promise<{ accountsUpdated: number; holdingsWritten: number }> {
  const byPlaidAccount = new Map<string, IngestHolding[]>();
  for (const h of holdings) {
    const list = byPlaidAccount.get(h.plaidAccountId) ?? [];
    list.push(h);
    byPlaidAccount.set(h.plaidAccountId, list);
  }

  let accountsUpdated = 0;
  let holdingsWritten = 0;

  for (const [plaidAccountId, group] of byPlaidAccount) {
    const [acct] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.plaidItemId, plaidItemRowId), eq(accounts.plaidAccountId, plaidAccountId)),
      )
      .limit(1);
    if (!acct) continue; // position for an account the client didn't link — skip

    // Resolve securities first (network/DB), outside the write txn.
    const resolved = await Promise.all(
      group.map(async (h) => ({ h, securityId: await ensureSecurityForTicker(h.ticker) })),
    );

    let value = 0;
    let basis = 0;
    const toInsert = resolved.map(({ h, securityId }) => {
      const tickered = Boolean(h.ticker);
      const marketValue = tickered ? null : h.institutionValue.toFixed(2);
      const mv = holdingMarketValue({
        marketValue: marketValue != null ? Number(marketValue) : null,
        shares: Number(h.shares),
        price: Number(h.price),
      });
      value += mv;
      basis += Number(h.costBasis);
      return {
        accountId: acct.id,
        source: "plaid" as const,
        securityId,
        plaidSecurityId: h.plaidSecurityId,
        displayTicker: h.ticker,
        displayName: h.name,
        shares: h.shares,
        price: h.price,
        priceAsOf: h.priceAsOf,
        costBasis: h.costBasis,
        marketValue,
      };
    });

    await db.transaction(async (tx) => {
      await tx
        .delete(accountHoldings)
        .where(
          and(eq(accountHoldings.accountId, acct.id), eq(accountHoldings.source, "plaid")),
        );
      if (toInsert.length) await tx.insert(accountHoldings).values(toInsert);
      await tx
        .update(accounts)
        .set({
          value: value.toFixed(2),
          basis: basis.toFixed(2),
          source: "plaid",
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, acct.id));
    });

    await syncAccountFromHoldings(acct.id); // re-derives allocations (respects deriveFromHoldings)
    accountsUpdated += 1;
    holdingsWritten += toInsert.length;
  }

  return { accountsUpdated, holdingsWritten };
}
