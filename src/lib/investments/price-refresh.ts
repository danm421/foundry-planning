import { stooqSymbol } from "./quote";

export interface RefreshHoldingInput {
  id: string;
  accountId: string;
  displayTicker: string | null;
  /** Stored price date as YYYY-MM-DD, or null if never priced. */
  priceAsOf: string | null;
  /** false ⇒ account is NOT driven by its holdings (skip blend re-sync). */
  deriveFromHoldings: boolean;
}

export interface HoldingPriceUpdate {
  id: string;
  price: number;
  asOf: string;
}

export interface PricePlan {
  holdingUpdates: HoldingPriceUpdate[];
  accountsToResync: string[];
}

/** Decide which holdings get a new price and which holdings-driven accounts need
 *  their value-weighted blend re-synced. Pure: a holding changes only when a
 *  quote exists for its symbol AND the quote date differs from the stored
 *  priceAsOf (so weekend/holiday re-runs are no-ops). `quotes` is keyed by
 *  upper-case Stooq symbol (as returned by fetchEodCloses). */
export function planPriceUpdates(input: {
  holdings: readonly RefreshHoldingInput[];
  quotes: ReadonlyMap<string, { price: number; asOf: string }>;
}): PricePlan {
  const holdingUpdates: HoldingPriceUpdate[] = [];
  const accounts = new Set<string>();

  for (const holding of input.holdings) {
    const ticker = holding.displayTicker?.trim();
    if (!ticker) continue;
    const quote = input.quotes.get(stooqSymbol(ticker).toUpperCase());
    if (!quote) continue;
    if (holding.priceAsOf === quote.asOf) continue;
    holdingUpdates.push({ id: holding.id, price: quote.price, asOf: quote.asOf });
    if (holding.deriveFromHoldings !== false) accounts.add(holding.accountId);
  }

  return { holdingUpdates, accountsToResync: [...accounts] };
}
