export interface QuoteDeps {
  /** Injectable fetcher returning raw EODHD /eod JSON. Defaults to the live call. */
  fetchEod?: (symbol: string) => Promise<unknown>;
}

const EODHD_EOD_BASE = "https://eodhd.com/api/eod";

/** A bare ticker (no exchange suffix) defaults to the US exchange — matches the
 *  classifier's symbol convention. Always upper-cased. */
export function eodSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  return t.includes(".") ? t : `${t}.US`;
}

/** Live EODHD /eod fetch: most recent close only. Throws on misconfig / HTTP
 *  error — the caller catches and fails soft. */
async function fetchEodLive(symbol: string): Promise<unknown> {
  const key = process.env.EODHD_API_KEY ?? "";
  if (!key) throw new Error("EODHD_API_KEY is not configured.");
  const url = `${EODHD_EOD_BASE}/${encodeURIComponent(symbol)}?api_token=${key}&fmt=json&order=d&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EODHD eod ${symbol}: HTTP ${res.status}`);
  return res.json();
}

/** Latest EOD close for a ticker, or null on ANY failure (unknown ticker,
 *  network/API error, malformed payload, missing key). Never throws. */
export async function fetchEodClose(
  ticker: string,
  deps: QuoteDeps = {},
): Promise<{ price: number; asOf: string } | null> {
  const fetchEod = deps.fetchEod ?? fetchEodLive;
  try {
    const raw = await fetchEod(eodSymbol(ticker));
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const row = raw[0] as { date?: unknown; close?: unknown };
    const price = typeof row.close === "number" ? row.close : NaN;
    const asOf = typeof row.date === "string" ? row.date : "";
    if (!Number.isFinite(price) || !asOf) return null;
    return { price, asOf };
  } catch {
    return null;
  }
}
