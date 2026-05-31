import type { MonthlyBar } from "./cma-stats";

const EODHD_EOD_BASE = "https://eodhd.com/api/eod";

interface EodRow {
  date: string;
  adjusted_close: number;
}

export interface EodHistoryDeps {
  /** Injectable JSON fetcher (defaults to live `fetch`). Tests pass a fixture. */
  fetchJson?: (url: string) => Promise<unknown>;
  /** Injectable API key (defaults to process.env.EODHD_API_KEY). */
  apiKey?: string;
}

async function liveFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EODHD eod: HTTP ${res.status}`);
  return res.json();
}

/**
 * Monthly adjusted-close history for one EODHD symbol from `from` to present.
 * `adjusted_close` includes reinvested dividends/splits → a total-return series.
 * Throws on misconfig / HTTP error (the orchestrator decides how to handle).
 */
export async function fetchMonthlyAdjustedClose(
  symbol: string,
  opts: { from: string },
  deps: EodHistoryDeps = {},
): Promise<MonthlyBar[]> {
  const apiKey = deps.apiKey ?? process.env.EODHD_API_KEY ?? "";
  if (!apiKey) throw new Error("EODHD_API_KEY is not configured. Set it in .env.local.");
  const fetchJson = deps.fetchJson ?? liveFetchJson;
  const url = `${EODHD_EOD_BASE}/${symbol}?api_token=${apiKey}&period=m&fmt=json&from=${opts.from}`;
  const rows = (await fetchJson(url)) as EodRow[];
  return rows.map((row) => ({ date: row.date, adjClose: row.adjusted_close }));
}
