import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fetchEodCloses, stooqSymbol, type QuoteDeps } from "@/lib/investments/quote";
import {
  planPriceUpdates,
  type RefreshHoldingInput,
  type HoldingPriceUpdate,
} from "@/lib/investments/price-refresh";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";

const UPDATE_CHUNK = 500;

export interface RefreshSummary {
  /** Tickered holdings that were considered (the rows passed in). */
  holdingsConsidered: number;
  /** Holdings whose stored price was changed. */
  holdingsUpdated: number;
  /** Distinct display tickers among the inputs. */
  uniqueTickers: number;
  /** Distinct Stooq symbols that resolved to a quote. */
  tickersPriced: number;
  /** Distinct display tickers Stooq could not price (fail-soft, not errors). */
  tickersMissing: string[];
  /** Holdings-driven accounts successfully re-synced. */
  accountsResynced: number;
  /** Per-account re-sync failures (collected, never thrown). */
  resyncFailures: { accountId: string; message: string }[];
}

/** Set-based bulk price update via UPDATE ... FROM (VALUES ...), chunked.
 *  Moved out of the cron route so the manual route shares one code path. */
export async function applyPriceUpdates(
  updates: readonly HoldingPriceUpdate[],
): Promise<void> {
  for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
    const chunk = updates.slice(i, i + UPDATE_CHUNK);
    if (chunk.length === 0) continue;
    const values = sql.join(
      chunk.map((u) => sql`(${u.id}::uuid, ${u.price}::numeric, ${u.asOf}::date)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE account_holdings AS h
      SET price = v.price, price_as_of = v.as_of, updated_at = now()
      FROM (VALUES ${values}) AS v(id, price, as_of)
      WHERE h.id = v.id
    `);
  }
}

/** Fetch latest closes for the holdings' tickers, write the changed prices, and
 *  re-sync each affected holdings-driven account. Fail-soft: unresolved symbols
 *  are reported in `tickersMissing` (not thrown) and per-account re-sync errors
 *  are collected in `resyncFailures`. The same-date guard in `planPriceUpdates`
 *  makes weekend/holiday/repeat runs no-ops. */
export async function refreshHoldings(
  holdings: readonly RefreshHoldingInput[],
  deps: QuoteDeps = {},
): Promise<RefreshSummary> {
  const tickers = holdings
    .map((h) => h.displayTicker?.trim())
    .filter((t): t is string => !!t);
  const uniqueTickers = [...new Set(tickers)];

  const quotes = await fetchEodCloses(tickers, deps);
  const { holdingUpdates, accountsToResync } = planPriceUpdates({ holdings, quotes });
  await applyPriceUpdates(holdingUpdates);

  const tickersMissing = uniqueTickers.filter(
    (t) => !quotes.get(stooqSymbol(t).toUpperCase()),
  );

  let accountsResynced = 0;
  const resyncFailures: { accountId: string; message: string }[] = [];
  for (const accountId of accountsToResync) {
    try {
      await syncAccountFromHoldings(accountId);
      accountsResynced += 1;
    } catch (err) {
      resyncFailures.push({
        accountId,
        message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
    }
  }

  return {
    holdingsConsidered: holdings.length,
    holdingsUpdated: holdingUpdates.length,
    uniqueTickers: uniqueTickers.length,
    tickersPriced: quotes.size,
    tickersMissing,
    accountsResynced,
    resyncFailures,
  };
}
