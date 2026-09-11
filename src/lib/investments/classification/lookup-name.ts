// src/lib/investments/classification/lookup-name.ts
//
// Name-only resolution via EODHD's `/search` endpoint — the fallback for when
// `/fundamentals` can't answer.
//
// Why it exists: fundamentals is a separately-licensed EODHD feed, and when the
// subscription doesn't cover it every unseeded ticker classifies to null. The
// advisor then sees a nameless row: they typed SWPPX and got back SWPPX, with
// no confirmation the app even recognised it. `/search` is on the base plan and
// returns the security's real name and instrument type.
//
// What it deliberately does NOT do is persist a `securities` row. Search gives
// no asset-allocation data, so a row written from it would carry zero weights —
// and `getSecurityByTicker` would then serve that empty row as a cache hit
// forever, permanently blocking the real classification. The name is returned
// for display only; the holding keeps `securityId: null` and stays honestly
// flagged as unclassified.
import { eodhdSymbol } from "@/lib/investments/quote";
import { mapSecurityType } from "./eodhd-adapter";
import type { SecurityType } from "./types";

export interface SecurityNameHit {
  name: string;
  securityType: SecurityType;
}

export interface LookupNameDeps {
  /** Injectable transport: takes an EODHD code and returns the parsed
   *  `/search` JSON. Defaults to the live call. */
  search?: (query: string) => Promise<unknown>;
}

const EODHD_SEARCH_BASE = "https://eodhd.com/api/search";

interface SearchRow {
  Code?: unknown;
  Exchange?: unknown;
  Type?: unknown;
  Name?: unknown;
}

/** Live EODHD search. Throws on misconfig / HTTP error; the caller fails soft. */
async function searchLive(query: string): Promise<unknown> {
  const key = process.env.EODHD_API_KEY ?? "";
  if (!key) throw new Error("EODHD_API_KEY is not configured.");
  const res = await fetch(
    `${EODHD_SEARCH_BASE}/${encodeURIComponent(query)}?api_token=${key}&fmt=json`,
  );
  if (!res.ok) throw new Error(`EODHD search ${query}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Resolve a ticker to its display name + instrument type, or null on any
 * failure (unknown ticker, no matching listing, transport error). Never throws.
 *
 * Matching is exact on both code AND exchange: `search/IBM` answers with every
 * exchange IBM trades on, so trusting row order would eventually hang a Buenos
 * Aires listing's name on a US holding.
 */
export async function lookupSecurityName(
  ticker: string,
  deps: LookupNameDeps = {},
): Promise<SecurityNameHit | null> {
  try {
    const symbol = eodhdSymbol(ticker);
    const cut = symbol.lastIndexOf(".");
    if (cut <= 0) return null;
    const code = symbol.slice(0, cut);
    const exchange = symbol.slice(cut + 1);

    const raw = await (deps.search ?? searchLive)(code);
    if (!Array.isArray(raw)) return null;
    for (const r of raw as SearchRow[]) {
      if (!r || typeof r.Code !== "string" || typeof r.Exchange !== "string") continue;
      if (r.Code.toUpperCase() !== code || r.Exchange.toUpperCase() !== exchange) continue;
      const name = typeof r.Name === "string" ? r.Name.trim() : "";
      if (!name) continue;
      return {
        name,
        securityType: mapSecurityType(typeof r.Type === "string" ? r.Type : undefined),
      };
    }
    return null;
  } catch {
    return null;
  }
}
