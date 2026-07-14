// mobile/src/invest/quotes.ts
//
// Pure merge of static holdings with live quotes for the investment detail
// modal. Quote lookup is by upper-cased ticker; a missing ticker or a
// missing quote both fall through to nulls (fail-soft — the caller still
// renders the static price/name in that case).

import type { LiveQuote, PortalHolding } from "@contracts";

export type HoldingWithQuote = PortalHolding & { livePrice: number | null; changePct: number | null };

export function withLiveQuotes(
  holdings: PortalHolding[],
  quotes: Record<string, LiveQuote>,
): HoldingWithQuote[] {
  return holdings.map((h) => {
    const q = h.ticker ? quotes[h.ticker.toUpperCase()] : undefined;
    return { ...h, livePrice: q ? q.price : null, changePct: q ? q.changePct : null };
  });
}
