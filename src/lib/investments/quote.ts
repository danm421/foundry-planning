// Latest daily close prices via EODHD's real-time multi-ticker endpoint.
// Replaces the retired Stooq `q/l/` quote endpoint (which now 404s / is behind a
// browser challenge). Fail-soft throughout: unresolved symbols are simply absent
// from the returned map and nothing throws to the caller — the refresh summary
// (tickersMissing) surfaces what couldn't be priced.

export interface QuoteDeps {
  /** Injectable EODHD API key (defaults to process.env.EODHD_API_KEY). */
  apiKey?: string;
  /** Injectable transport: takes a chunk of EODHD symbols (e.g. ["VTI.US"]) and
   *  returns the parsed real-time JSON — an object for one symbol, an array for
   *  many. Defaults to the live EODHD call. */
  fetchRealtime?: (symbols: string[]) => Promise<unknown>;
}

const EODHD_REALTIME_BASE = "https://eodhd.com/api/real-time";
// EODHD takes one primary symbol in the path plus a comma list in `s=`. Keep
// chunks modest so one failing chunk can't sink a large refresh.
const BATCH_SIZE = 50;

/** Canonical EODHD symbol (UPPERCASE): bare US ticker → `VTI.US`; a US class
 *  share dot → dash (`BRK.B` → `BRK-B.US`); an existing exchange suffix
 *  (foreign) passes through (`BMW.XETRA`) and generally won't resolve — fail-soft. */
export function eodhdSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (/^[A-Z]+\.[A-Z]$/.test(t)) return `${t.replace(".", "-")}.US`;
  if (t.includes(".")) return t;
  return `${t}.US`;
}

interface RealtimeRow {
  code?: unknown;
  close?: unknown;
  timestamp?: unknown;
}

/** Live EODHD real-time fetch for one chunk. Throws on HTTP error; callers catch
 *  and fail soft. Commas in `s=` are kept literal (EODHD expects them raw). */
async function fetchRealtimeLive(symbols: string[], apiKey: string): Promise<unknown> {
  const [first, ...rest] = symbols;
  const sParam = rest.length ? `&s=${rest.join(",")}` : "";
  const url = `${EODHD_REALTIME_BASE}/${encodeURIComponent(first)}?api_token=${apiKey}&fmt=json${sParam}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EODHD real-time ${first}+${rest.length}: HTTP ${res.status}`);
  return res.json();
}

/** EODHD epoch-seconds timestamp → YYYY-MM-DD (UTC). US closes land on the same
 *  UTC day, so this is the trading date for our daily priceAsOf model. */
function tsToDate(ts: number): string | null {
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** Normalize a real-time response (object for one symbol, array for many) into
 *  map entries keyed by upper-case EODHD code. Rows with a non-finite/non-positive
 *  close, missing code, or unparseable timestamp are dropped (fail-soft). */
function collectRows(
  raw: unknown,
  out: Map<string, { price: number; asOf: string }>,
): void {
  const rows: RealtimeRow[] = Array.isArray(raw) ? raw : [raw as RealtimeRow];
  for (const r of rows) {
    if (!r || typeof r.code !== "string") continue;
    const price = typeof r.close === "number" ? r.close : Number(r.close);
    const asOf = tsToDate(typeof r.timestamp === "number" ? r.timestamp : Number(r.timestamp));
    if (!Number.isFinite(price) || price <= 0 || !asOf) continue;
    out.set(r.code.toUpperCase(), { price, asOf });
  }
}

/** Resolve the transport: an injected fetcher wins; otherwise the live EODHD
 *  call bound to the configured key. Throws if neither is available — callers
 *  decide whether to swallow (fail-soft) or surface. */
function resolveFetch(deps: QuoteDeps): (symbols: string[]) => Promise<unknown> {
  if (deps.fetchRealtime) return deps.fetchRealtime;
  const apiKey = deps.apiKey ?? process.env.EODHD_API_KEY ?? "";
  if (!apiKey) {
    // Distinguish misconfig (loud) from a routine unresolved ticker (silent).
    // The callers below fail soft, so without this a missing key looks identical
    // to "ticker not found" — every quote silently returns null and the cause
    // is invisible in the logs.
    console.warn(
      "[investments/quote] EODHD_API_KEY is not configured — holdings prices will be null. " +
        "Set EODHD_API_KEY in .env.local (and in Vercel env for preview/prod).",
    );
    throw new Error("EODHD_API_KEY is not configured. Set it in .env.local.");
  }
  return (symbols) => fetchRealtimeLive(symbols, apiKey);
}

/** Latest close for one ticker, or null on ANY failure. Never throws. */
export async function fetchEodClose(
  ticker: string,
  deps: QuoteDeps = {},
): Promise<{ price: number; asOf: string } | null> {
  try {
    const fetchRealtime = resolveFetch(deps);
    const sym = eodhdSymbol(ticker);
    const out = new Map<string, { price: number; asOf: string }>();
    collectRows(await fetchRealtime([sym]), out);
    return out.get(sym) ?? null;
  } catch {
    return null;
  }
}

export type LiveQuote = { price: number; changePct: number | null; asOf: string };

const QUOTE_TTL_MS = 60_000;
const quoteCache = new Map<string, { q: LiveQuote; at: number }>();

/** Batched live quotes (price + daily change %) for the portal holdings list.
 *  One EODHD real-time call for all symbols; 60s in-memory cache (skipped when a
 *  custom fetchRealtime is injected). Never throws. */
export async function fetchEodQuotes(
  tickers: string[],
  deps: QuoteDeps = {},
): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  const now = Date.now();
  const symbols = [...new Set(tickers.map(eodhdSymbol))];
  // The TTL cache only applies when using the live EODHD transport. An injected
  // fetchRealtime (tests / overrides) always fetches fresh.
  const useCache = !deps.fetchRealtime;
  const miss: string[] = [];
  for (const sym of symbols) {
    const c = useCache ? quoteCache.get(sym) : undefined;
    if (c && now - c.at < QUOTE_TTL_MS) out.set(sym, c.q);
    else miss.push(sym);
  }
  if (miss.length === 0) return out;
  let fetchRealtime: (symbols: string[]) => Promise<unknown>;
  try {
    fetchRealtime = resolveFetch(deps);
  } catch {
    return out; // missing key → fail-soft; cached hits are preserved
  }
  try {
    const raw = await fetchRealtime(miss);
    const rows = Array.isArray(raw) ? raw : [raw];
    for (const r of rows as Array<{ code?: unknown; close?: unknown; change_p?: unknown; timestamp?: unknown }>) {
      if (!r || typeof r.code !== "string") continue;
      const price = typeof r.close === "number" ? r.close : Number(r.close);
      if (!Number.isFinite(price)) continue;
      const changePct = typeof r.change_p === "number" ? r.change_p : null;
      const ts = typeof r.timestamp === "number" ? r.timestamp : Number(r.timestamp);
      const asOf = tsToDate(ts) ?? "";
      const sym = r.code.toUpperCase();
      const q: LiveQuote = { price, changePct, asOf };
      out.set(sym, q);
      if (useCache) quoteCache.set(sym, { q, at: now });
    }
  } catch {
    // fail-soft: missing symbols simply absent; cached hits preserved
  }
  return out;
}

/** Latest close for many tickers in batched requests. Returns a map keyed by
 *  upper-case EODHD code. Dedups symbols, chunks at BATCH_SIZE, retries a failing
 *  chunk once, then skips it. Never throws (misconfig/transport → fewer entries). */
export async function fetchEodCloses(
  tickers: readonly string[],
  deps: QuoteDeps = {},
): Promise<Map<string, { price: number; asOf: string }>> {
  const out = new Map<string, { price: number; asOf: string }>();
  let fetchRealtime: (symbols: string[]) => Promise<unknown>;
  try {
    fetchRealtime = resolveFetch(deps);
  } catch {
    return out; // missing key → empty (fail-soft); the summary surfaces the misses
  }

  const symbols = [...new Set(tickers.map(eodhdSymbol))];
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const chunk = symbols.slice(i, i + BATCH_SIZE);
    let raw: unknown = null;
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        raw = await fetchRealtime(chunk);
        ok = true;
      } catch {
        ok = false; // retry once, then give up on this chunk
      }
    }
    if (ok) collectRows(raw, out);
  }
  return out;
}
