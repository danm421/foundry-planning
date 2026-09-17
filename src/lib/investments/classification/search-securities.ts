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
// `/search` matches words exactly, so a statement's own spelling usually finds
// nothing on the first try; `security-name-match.ts` explains the relaxation
// ladder and the re-ranking that compensate for it.
//
// Like lookup-name, nothing here writes a `securities` row. Search carries no
// asset-allocation data, and a zero-weight row would cache as a permanent miss
// for `getSecurityByTicker`. Picking a hit only fills in the ticker; the real
// classification still runs through `/classify`.
import { MIN_SEARCH_QUERY } from "@/lib/schemas/holdings";
import { mapSecurityType } from "./eodhd-adapter";
import { eodhdSearch, type EodhdSearch, type EodhdSearchRow } from "./eodhd-search";
import { expandAbbreviations, relaxationLadder, scoreMatch, tokenize } from "./security-name-match";
import { fetchEodQuotes, eodhdSymbol } from "../quote";
import type { LiveQuote } from "@/lib/portal/contracts";
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
  /** Latest close — the search row's own dated previousClose when it has one,
   *  otherwise the quote feed's. Absent — not zero — when neither answers: an
   *  advisor must be able to tell "we don't know" from "it's worthless", and a
   *  whole-list blank is how a dead price entitlement announces itself instead
   *  of hiding as a row of $0.00. */
  price?: number;
}

export interface SecuritySearchResult {
  hits: SecuritySearchHit[];
  /** The query that actually produced these rows, when it is not the one that
   *  was typed. The picker shows it: rows that don't obviously match what you
   *  typed are confusing unless you're told the search was widened. */
  relaxedTo: string | null;
}

export interface SearchSecuritiesDeps {
  search?: EodhdSearch;
  /** Injectable quote lookup — but ONLY consulted when `search` is left at its
   *  default, so an injected search transport can never leak a live quote call.
   *  The same guard `quote.ts` puts on its own `fetchLastDay`, and it matters
   *  here because vitest loads `.env.local`, so a real key IS present in tests. */
  quotes?: (tickers: string[]) => Promise<Map<string, LiveQuote>>;
}

export const MAX_SEARCH_RESULTS = 10;

/** Parse `/search` rows into hits, one per symbol, dropping the unusable. */
function toHits(raw: unknown): SecuritySearchHit[] {
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
    // The row prices itself: `/search` carries previousClose, and on a plan
    // whose quote feeds are refusing it is the only close we can get. A
    // non-positive or undated one is dropped, never shown as $0.00.
    const close = typeof r.previousClose === "number" ? r.previousClose : Number(r.previousClose);
    const priced = Number.isFinite(close) && close > 0
      && typeof r.previousCloseDate === "string" && r.previousCloseDate !== "";
    hits.push({
      ticker,
      name,
      exchange,
      securityType: mapSecurityType(typeof r.Type === "string" ? r.Type : undefined),
      ...(priced ? { price: close } : {}),
    });
  }
  return hits;
}

/**
 * Order the rows: US listings first, best match first within each group.
 *
 * US first stays a hard partition rather than a scoring bonus. Prices,
 * classification and the engine are all USD and a foreign line comes back
 * unpriced, so the listing the advisor almost certainly means belongs above a
 * better-worded foreign one, not merely near it. Ranking inside each group is
 * what relaxing the query costs nothing: the widened search decides WHICH rows
 * come back, the full typed name decides which of them leads.
 */
function rank(hits: SecuritySearchHit[], query: string): SecuritySearchHit[] {
  const wanted = expandAbbreviations(tokenize(query));
  const scored = hits.map((hit, i) => ({
    hit,
    i, // stable tie-break: EODHD's own relevance order survives an exact tie
    score: scoreMatch({ code: hit.ticker, name: hit.name }, wanted),
    us: hit.exchange === "US",
  }));
  scored.sort((a, b) => {
    if (a.us !== b.us) return a.us ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.i - b.i;
  });
  return scored.map((s) => s.hit);
}

/** Attach the latest close to the hits that didn't come with one. Fail-soft by
 *  construction: `fetchEodQuotes` never throws, and an unpriced symbol is
 *  simply left without a price rather than shown as zero. */
async function attachPrices(
  hits: SecuritySearchHit[],
  deps: SearchSecuritiesDeps,
): Promise<SecuritySearchHit[]> {
  // No quote transport to use: either one was named, or the search transport is
  // the live one and the live quote call is the right default. An injected
  // search with no injected quotes prices nothing — see SearchSecuritiesDeps.
  const fetchQuotes =
    deps.quotes ?? (deps.search ? null : (t: string[]) => fetchEodQuotes(t));
  // Only the rows `/search` gave no close for — asking about the rest would buy
  // a call per hit to learn a number already in hand.
  const need = hits.filter((h) => h.price == null).map((h) => h.ticker);
  if (!fetchQuotes || need.length === 0) return hits;
  const quotes = await fetchQuotes(need);
  if (quotes.size === 0) return hits;
  return hits.map((hit) => {
    const q = quotes.get(eodhdSymbol(hit.ticker));
    return q ? { ...hit, price: q.price } : hit;
  });
}

/**
 * Securities matching free text (a name or a ticker), best match first.
 *
 * Throws on a transport/config failure rather than failing soft: this runs on a
 * deliberate click, and "no matches" is a different answer from "the search is
 * down". Callers surface the difference. Pricing is the exception — it is
 * decoration on a row that is already useful, so a dead quote feed costs the
 * price column and nothing else.
 */
export async function searchSecurities(
  query: string,
  deps: SearchSecuritiesDeps = {},
): Promise<SecuritySearchResult> {
  const q = query.trim();
  if (q.length < MIN_SEARCH_QUERY) return { hits: [], relaxedTo: null };

  const search = deps.search ?? eodhdSearch;
  const ladder = relaxationLadder(q);

  for (const [step, attempt] of ladder.entries()) {
    const hits = toHits(await search(attempt));
    if (hits.length === 0) continue;
    return {
      hits: await attachPrices(rank(hits, q).slice(0, MAX_SEARCH_RESULTS), deps),
      relaxedTo: step === 0 ? null : attempt,
    };
  }
  return { hits: [], relaxedTo: null };
}
