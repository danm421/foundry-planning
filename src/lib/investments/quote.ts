// Latest daily close prices via EODHD's real-time multi-ticker endpoint.
// Replaces the retired Stooq `q/l/` quote endpoint (which now 404s / is behind a
// browser challenge). Fail-soft throughout: unresolved symbols are simply absent
// from the returned map and nothing throws to the caller — the refresh summary
// (tickersMissing) surfaces what couldn't be priced.
import type { LiveQuote } from "@/lib/portal/contracts";

export type { LiveQuote } from "@/lib/portal/contracts";

export interface QuoteDeps {
  /** Injectable EODHD API key (defaults to process.env.EODHD_API_KEY). */
  apiKey?: string;
  /** Injectable transport: takes a chunk of EODHD symbols (e.g. ["VTI.US"]) and
   *  returns the parsed real-time JSON — an object for one symbol, an array for
   *  many. Defaults to the live EODHD call. */
  fetchRealtime?: (symbols: string[]) => Promise<unknown>;
  /** Injectable last-day fallback: takes bare US codes (e.g. ["SWCGX"]) and
   *  returns the parsed bulk end-of-day JSON. Defaults to the live EODHD call —
   *  but ONLY when `fetchRealtime` is left at its default, so an injected
   *  transport can never leak a live request. */
  fetchLastDay?: (codes: string[]) => Promise<unknown>;
}

const EODHD_REALTIME_BASE = "https://eodhd.com/api/real-time";
const EODHD_BULK_EOD_BASE = "https://eodhd.com/api/eod-bulk-last-day";
// EODHD takes one primary symbol in the path plus a comma list in `s=`. Keep
// chunks modest so one failing chunk can't sink a large refresh.
const BATCH_SIZE = 50;

/**
 * Bare tickers whose primary listing is NOT in the US, mapped to their
 * USD-denominated ADR line.
 *
 * Why an ADR and not the home exchange: EODHD's `adjusted_close` is quoted in
 * the listing's own currency, so `CRDA.LSE` would feed GBP returns and
 * `IMCD.AS` EUR returns into a portfolio whose every other holding is in USD.
 * The backtest would then report a currency move as an investment result. The
 * ADR is the same economic exposure already translated to USD, which is also
 * what the client's statement shows — our `securities` rows literally name
 * several of these "… ADR".
 *
 * Each entry was resolved against EODHD's own search endpoint (name match) and
 * verified to clear the history gates the backfill enforces (≥36 monthly
 * returns, ≥95% dense). Kept deliberately short and explicit rather than
 * derived: a wrong guess here silently attributes another company's history to
 * a client's holding.
 *
 * Left unmapped on purpose:
 *   CRDA (Croda) — the only USD line, COIHY, is 90.6% dense and fails the gate,
 *   so it stays honestly uncovered rather than gappy.
 */
const TICKER_TO_EODHD_SYMBOL: Readonly<Record<string, string>> = {
  ABB: "ABBNY.US", // ABB Ltd — no ABB.US exists; ABB.ST is SEK
  DPLM: "DPLMF.US", // Diploma PLC — DPLM.LSE is GBP
  EXPN: "EXPGY.US", // Experian PLC — EXPN.LSE is GBP
  IMCD: "IMCDY.US", // IMCD N.V. — IMCD.AS is EUR
  WKL: "WTKWY.US", // Wolters Kluwer — WKL.US is a dead, unrelated same-code line
};

/** Canonical EODHD symbol (UPPERCASE): bare US ticker → `VTI.US`; a US class
 *  share dot → dash (`BRK.B` → `BRK-B.US`); a bare ticker with no US listing →
 *  its USD ADR (see `TICKER_TO_EODHD_SYMBOL`); an existing exchange suffix
 *  (foreign) passes through (`BMW.XETRA`) and generally won't resolve — fail-soft. */
export function eodhdSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (/^[A-Z]+\.[A-Z]$/.test(t)) return `${t.replace(".", "-")}.US`;
  // An explicit suffix is a deliberate choice by whoever typed it — the ADR
  // redirect applies only to the bare form.
  if (t.includes(".")) return t;
  return TICKER_TO_EODHD_SYMBOL[t] ?? `${t}.US`;
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

/** Live EODHD bulk end-of-day fetch for one chunk of bare US codes. Throws on
 *  HTTP error; callers catch and fail soft. */
async function fetchLastDayLive(codes: string[], apiKey: string): Promise<unknown> {
  const url = `${EODHD_BULK_EOD_BASE}/US?api_token=${apiKey}&fmt=json&symbols=${codes.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EODHD bulk EOD ${codes.length} symbols: HTTP ${res.status}`);
  return res.json();
}

/** EODHD epoch-seconds timestamp → YYYY-MM-DD (UTC). US closes land on the same
 *  UTC day, so this is the trading date for our daily priceAsOf model. */
function tsToDate(ts: number): string | null {
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** EODHD answers with a bare object for one symbol and an array for many. */
function asRows<T>(raw: unknown): T[] {
  return (Array.isArray(raw) ? raw : [raw]) as T[];
}

/** Normalize a real-time response (object for one symbol, array for many) into
 *  map entries keyed by upper-case EODHD code. Rows with a non-finite/non-positive
 *  close, missing code, or unparseable timestamp are dropped (fail-soft). */
function collectRows(
  raw: unknown,
  out: Map<string, { price: number; asOf: string }>,
): void {
  for (const r of asRows<RealtimeRow>(raw)) {
    if (!r || typeof r.code !== "string") continue;
    const price = typeof r.close === "number" ? r.close : Number(r.close);
    const asOf = tsToDate(typeof r.timestamp === "number" ? r.timestamp : Number(r.timestamp));
    if (!Number.isFinite(price) || price <= 0 || !asOf) continue;
    out.set(r.code.toUpperCase(), { price, asOf });
  }
}

interface LastDayRow {
  code?: unknown;
  exchange_short_name?: unknown;
  date?: unknown;
  close?: unknown;
  change_p?: unknown;
}

/** Normalize a bulk end-of-day response into map entries keyed the same way the
 *  real-time rows are (`SWCGX.US`), so either feed can fill the same map.
 *  Unknown symbols come back as all-`"NA"` rows and are dropped. */
function collectLastDayRows(raw: unknown, out: Map<string, LiveQuote>): void {
  for (const r of asRows<LastDayRow>(raw)) {
    if (!r || typeof r.code !== "string" || typeof r.exchange_short_name !== "string") continue;
    const asOf = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    const price = typeof r.close === "number" ? r.close : Number(r.close);
    if (!asOf || !Number.isFinite(price) || price <= 0) continue;
    const cp = r.change_p == null ? null : Number(r.change_p);
    out.set(`${r.code}.${r.exchange_short_name}`.toUpperCase(), {
      price,
      asOf,
      changePct: cp !== null && Number.isFinite(cp) ? cp : null,
    });
  }
}

/** The configured EODHD key, or "" when none is available. */
function resolveApiKey(deps: QuoteDeps): string {
  return deps.apiKey ?? process.env.EODHD_API_KEY ?? "";
}

/** Resolve the last-day fallback transport, or null when it must not run.
 *
 *  `fetchRealtime` is injected by unit tests only (no production caller passes
 *  one), so treating it as "the caller drives every transport" keeps those
 *  tests off the network without changing any live behavior. A future
 *  production injector must pass `fetchLastDay` too, or it silently loses the
 *  fallback. */
function resolveLastDay(deps: QuoteDeps): ((codes: string[]) => Promise<unknown>) | null {
  if (deps.fetchLastDay) return deps.fetchLastDay;
  if (deps.fetchRealtime) return null;
  const apiKey = resolveApiKey(deps);
  if (!apiKey) return null;
  return (codes) => fetchLastDayLive(codes, apiKey);
}

/**
 * Last daily close for the symbols the real-time feed couldn't price.
 * Never throws — an unresolvable symbol is simply absent.
 *
 * Why this exists: a mutual fund strikes one NAV per day, after the close, so
 * EODHD's real-time endpoint answers `close: "NA"` for it right through the
 * trading day. Without this pass a client's Schwab/Vanguard funds — often most
 * of the portfolio — show a $0.00 price and a $0 market value. The end-of-day
 * row still carries the prior session's NAV *and* its own date, which is what
 * priceAsOf needs; `previousClose` on the real-time row has no date to go with it.
 *
 * Only `.US` symbols are eligible: the bulk feed is addressed per exchange.
 */
async function fetchLastDayFor(
  unpriced: readonly string[],
  deps: QuoteDeps,
): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  const fetchLastDay = resolveLastDay(deps);
  if (!fetchLastDay) return out;
  const codes = unpriced.filter((s) => s.endsWith(".US")).map((s) => s.slice(0, -".US".length));
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += BATCH_SIZE) chunks.push(codes.slice(i, i + BATCH_SIZE));
  // Chunks are independent, so the nightly price cron doesn't pay for them serially.
  await Promise.all(
    chunks.map(async (c) => {
      try {
        collectLastDayRows(await fetchLastDay(c), out);
      } catch {
        // fail-soft: this chunk stays unpriced, the rest of the map survives
      }
    }),
  );
  return out;
}

/** Resolve the transport: an injected fetcher wins; otherwise the live EODHD
 *  call bound to the configured key. Throws if neither is available — callers
 *  decide whether to swallow (fail-soft) or surface. */
function resolveFetch(deps: QuoteDeps): (symbols: string[]) => Promise<unknown> {
  if (deps.fetchRealtime) return deps.fetchRealtime;
  const apiKey = resolveApiKey(deps);
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

/** Latest close for one ticker, or null on ANY failure. Never throws.
 *  A one-element batch — same real-time call, same chunk retry, same last-day
 *  fallback, so the single- and many-ticker paths can't drift apart. */
export async function fetchEodClose(
  ticker: string,
  deps: QuoteDeps = {},
): Promise<{ price: number; asOf: string } | null> {
  return (await fetchEodCloses([ticker], deps)).get(eodhdSymbol(ticker)) ?? null;
}

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
      if (!Number.isFinite(price) || price <= 0) continue;
      const _cp = r.change_p == null ? null : Number(r.change_p);
      const changePct: number | null = _cp !== null && Number.isFinite(_cp) ? _cp : null;
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
  // Mutual funds show no real-time close until their NAV strikes — fall back to
  // the last daily close so they aren't blank all session.
  for (const [sym, q] of await fetchLastDayFor(miss.filter((s) => !out.has(s)), deps)) {
    out.set(sym, q);
    if (useCache) quoteCache.set(sym, { q, at: now });
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
  for (const [sym, hit] of await fetchLastDayFor(symbols.filter((s) => !out.has(s)), deps)) {
    out.set(sym, { price: hit.price, asOf: hit.asOf });
  }
  return out;
}
