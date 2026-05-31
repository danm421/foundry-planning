export interface QuoteDeps {
  /** Injectable fetcher: takes the Stooq `s=` query value (one symbol or a
   *  `+`-joined list) and returns the raw CSV. Defaults to the live call. */
  fetchCsv?: (query: string) => Promise<string>;
}

const STOOQ_QUOTE_BASE = "https://stooq.com/q/l/";
const BATCH_SIZE = 50;

/** Map a ticker to its Stooq symbol (lower-cased). Bare US ticker → `vti.us`;
 *  US class share → `brk-b.us` (Stooq uses a dash, not a dot); an existing
 *  exchange suffix (foreign) passes through lower-cased and generally won't
 *  resolve on Stooq (fail-soft). */
export function stooqSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (/^[A-Z]+\.[A-Z]$/.test(t)) return `${t.replace(".", "-").toLowerCase()}.us`;
  if (t.includes(".")) return t.toLowerCase();
  return `${t.toLowerCase()}.us`;
}

/** Live Stooq quote fetch. `query` is the `s=` value; each symbol is encoded
 *  individually so the `+` separator survives. Throws on HTTP error — callers
 *  catch and fail soft. */
async function fetchStooqCsv(query: string): Promise<string> {
  const encoded = query.split("+").map(encodeURIComponent).join("+");
  const url = `${STOOQ_QUOTE_BASE}?s=${encoded}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stooq quote ${query}: HTTP ${res.status}`);
  return res.text();
}

/** Parse a Stooq /q/l CSV (header + N data rows) into a map keyed by the
 *  upper-case Stooq symbol Stooq echoes back. Rows with `N/D` (unknown symbol)
 *  or a malformed close/date are dropped. */
function parseStooqRows(csv: string): Map<string, { price: number; asOf: string }> {
  const out = new Map<string, { price: number; asOf: string }>();
  const lines = csv.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 7) continue;
    const sym = cols[0].trim().toUpperCase();
    const asOf = cols[1];
    const price = Number(cols[6]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(price)) continue;
    out.set(sym, { price, asOf });
  }
  return out;
}

/** Latest daily close for one ticker, or null on ANY failure. Never throws. */
export async function fetchEodClose(
  ticker: string,
  deps: QuoteDeps = {},
): Promise<{ price: number; asOf: string } | null> {
  const fetchCsv = deps.fetchCsv ?? fetchStooqCsv;
  try {
    const rows = parseStooqRows(await fetchCsv(stooqSymbol(ticker)));
    return rows.get(stooqSymbol(ticker).toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

/** Latest daily close for many tickers in batched requests. Returns a map keyed
 *  by upper-case Stooq symbol. Dedups symbols, chunks at BATCH_SIZE, retries a
 *  failing chunk once, then skips it. Never throws. */
export async function fetchEodCloses(
  tickers: readonly string[],
  deps: QuoteDeps = {},
): Promise<Map<string, { price: number; asOf: string }>> {
  const fetchCsv = deps.fetchCsv ?? fetchStooqCsv;
  const symbols = [...new Set(tickers.map(stooqSymbol))];
  const out = new Map<string, { price: number; asOf: string }>();

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const chunk = symbols.slice(i, i + BATCH_SIZE);
    const query = chunk.join("+");
    let csv: string | null = null;
    for (let attempt = 0; attempt < 2 && csv === null; attempt++) {
      try {
        csv = await fetchCsv(query);
      } catch {
        csv = null; // retry once, then give up on this chunk
      }
    }
    if (csv === null) continue;
    for (const [sym, quote] of parseStooqRows(csv)) out.set(sym, quote);
  }
  return out;
}
