// src/lib/investments/classification/eodhd-search.ts
//
// One transport for EODHD's `/search` endpoint, shared by the two questions we
// ask it: "what is this exact ticker called?" (lookup-name.ts) and "which
// securities match this text?" (search-securities.ts). Kept in one place so the
// key check and URL shape can't drift between them.
//
// `/search` is on the base EODHD plan — unlike `/fundamentals`, which is
// licensed separately. That is why it can be relied on for both.

/** The `/search` row fields we read. EODHD returns more; the rest is ignored. */
export interface EodhdSearchRow {
  Code?: unknown;
  Exchange?: unknown;
  Type?: unknown;
  Name?: unknown;
}

/** Injectable transport: takes a query and returns the parsed `/search` JSON. */
export type EodhdSearch = (query: string) => Promise<unknown>;

const EODHD_SEARCH_BASE = "https://eodhd.com/api/search";

/** Live EODHD search. Throws on misconfig / HTTP error; callers decide whether
 *  to fail soft (a background name lookup) or surface it (an advisor's click). */
export async function eodhdSearch(query: string): Promise<unknown> {
  const key = process.env.EODHD_API_KEY ?? "";
  if (!key) throw new Error("EODHD_API_KEY is not configured.");
  const res = await fetch(
    `${EODHD_SEARCH_BASE}/${encodeURIComponent(query)}?api_token=${key}&fmt=json&limit=30`,
  );
  if (!res.ok) throw new Error(`EODHD search ${query}: HTTP ${res.status}`);
  return res.json();
}
