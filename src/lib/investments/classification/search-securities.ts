// src/lib/investments/classification/search-securities.ts
//
// Free-text security search — the "I have the fund's NAME, not its ticker" path.
//
// `lookup-name.ts` asks EODHD's `/search` a narrower question (what is THIS
// exact ticker called) and discards every row that isn't an exact code+exchange
// match. Here the rows themselves are the answer: `/search` matches on security
// name as readily as on code, which is what an advisor reading a statement
// usually has in hand — "Vanguard Total Stock Market Index Admiral", no symbol.
//
// Like lookup-name, nothing here writes a `securities` row. Search carries no
// asset-allocation data, and a zero-weight row would cache as a permanent miss
// for `getSecurityByTicker`. Picking a hit only fills in the ticker; the real
// classification still runs through `/classify`.
import { MIN_SEARCH_QUERY } from "@/lib/schemas/holdings";
import { mapSecurityType } from "./eodhd-adapter";
import { eodhdSearch, type EodhdSearch, type EodhdSearchRow } from "./eodhd-search";
import type { SecurityType } from "./types";

export interface SecuritySearchHit {
  /** What to store as the holding's displayTicker — bare for a US listing,
   *  `CODE.EXCHANGE` otherwise. That second form is exactly what `eodhdSymbol`
   *  passes through untouched, so a picked foreign line still prices. */
  ticker: string;
  name: string;
  /** EODHD exchange code ("US", "LSE", …). Shown so two listings of the same
   *  company are tellable apart. */
  exchange: string;
  securityType: SecurityType;
}

export interface SearchSecuritiesDeps {
  search?: EodhdSearch;
}

export const MAX_SEARCH_RESULTS = 10;

/**
 * Securities matching free text (a name or a ticker), best match first.
 *
 * Throws on a transport/config failure rather than failing soft: this runs on a
 * deliberate click, and "no matches" is a different answer from "the search is
 * down". Callers surface the difference.
 */
export async function searchSecurities(
  query: string,
  deps: SearchSecuritiesDeps = {},
): Promise<SecuritySearchHit[]> {
  const q = query.trim();
  if (q.length < MIN_SEARCH_QUERY) return [];

  const raw = await (deps.search ?? eodhdSearch)(q);
  if (!Array.isArray(raw)) return [];

  const hits: SecuritySearchHit[] = [];
  const seen = new Set<string>();
  for (const r of raw as EodhdSearchRow[]) {
    if (!r || typeof r.Code !== "string" || typeof r.Exchange !== "string") continue;
    const name = typeof r.Name === "string" ? r.Name.trim() : "";
    if (!name) continue;
    const code = r.Code.toUpperCase();
    const exchange = r.Exchange.toUpperCase();
    const ticker = exchange === "US" ? code : `${code}.${exchange}`;
    // One line per symbol: EODHD repeats a listing across its index entries.
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    hits.push({
      ticker,
      name,
      exchange,
      securityType: mapSecurityType(typeof r.Type === "string" ? r.Type : undefined),
    });
  }

  // US listings first. Prices, classification and the engine are all USD, and a
  // foreign line comes back unpriced — so the listing the advisor almost
  // certainly means goes to the top. EODHD's own relevance order survives
  // within each group.
  return [
    ...hits.filter((h) => h.exchange === "US"),
    ...hits.filter((h) => h.exchange !== "US"),
  ].slice(0, MAX_SEARCH_RESULTS);
}
