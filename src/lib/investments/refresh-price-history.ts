import type { MonthlyBar } from "@/lib/cma-stats";
import { assessPriceSeries, priorMonthKey } from "./price-history-gates";

/**
 * Keep `security_price_history` current for every security a portfolio actually
 * references — client account holdings AND fund-portfolio holdings.
 *
 * The pre-existing monthly cron (`refresh-ticker-portfolios`) walks
 * `ticker_portfolios` only, and prod has none, so nothing was refreshing the
 * securities that clients actually hold. Without a refresh, a holding's series
 * goes stale, and a stale series truncates the END of the shared backtest
 * window for every other holding beside it.
 *
 * Pure orchestration over injected deps so it runs in plain vitest — the route
 * handler supplies the DB reads/writes and the EODHD fetch.
 */

export interface ReferencedSecurity {
  id: string;
  /** The stored identifier, e.g. `VTI`. */
  identifier: string;
  /** `ticker`, `cusip`, `figi`, … — only `ticker` is addressable at EODHD. */
  identifierType: string;
  /** Highest stored month (`YYYY-MM`), or null when nothing is stored. */
  lastBar: string | null;
}

export interface RefreshDeps {
  listReferenced: () => Promise<ReferencedSecurity[]>;
  /** Fetch monthly adjusted closes for an EODHD symbol. May throw. */
  fetchBars: (symbol: string) => Promise<MonthlyBar[]>;
  /** Map a stored ticker to its EODHD symbol. */
  toSymbol: (ticker: string) => string;
  writeBars: (securityId: string, bars: MonthlyBar[]) => Promise<void>;
  now: Date;
  /** Stop after this many FETCHED securities (API budget). Default: no cap. */
  limit?: number;
  /** Pause between fetches, ms. */
  throttleMs?: number;
  onProgress?: (msg: string) => void;
}

export interface RefreshSkip {
  ticker: string;
  reason: string;
  stale?: boolean;
}

export interface RefreshSummary {
  referenced: number;
  /** Already carried the latest closed month — not fetched. */
  fresh: number;
  /** Securities that gained at least one bar. */
  written: number;
  barsWritten: number;
  skipped: RefreshSkip[];
  failed: { ticker: string; error: string }[];
  /** True when `limit` stopped the run before the list was exhausted. */
  truncated: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function refreshReferencedPriceHistory(deps: RefreshDeps): Promise<RefreshSummary> {
  const referenced = await deps.listReferenced();
  const prior = priorMonthKey(deps.now);
  const limit = deps.limit ?? Infinity;

  const summary: RefreshSummary = {
    referenced: referenced.length,
    fresh: 0,
    written: 0,
    barsWritten: 0,
    skipped: [],
    failed: [],
    truncated: false,
  };

  let fetched = 0;
  for (const sec of referenced) {
    if (fetched >= limit) {
      summary.truncated = true;
      break;
    }

    const ticker = sec.identifier?.toUpperCase() ?? "";

    // EODHD is addressed by symbol; a CUSIP/FIGI row has nothing to ask for.
    // Report rather than guess at a mapping.
    if (sec.identifierType !== "ticker") {
      summary.skipped.push({
        ticker: `${sec.identifier} (${sec.identifierType})`,
        reason: "not ticker-identified",
      });
      continue;
    }

    // Same freshness rule as `isFresh` in lib/ticker-history.ts.
    if (sec.lastBar && sec.lastBar.slice(0, 7) >= prior) {
      summary.fresh++;
      continue;
    }

    fetched++;
    let bars: MonthlyBar[];
    try {
      bars = await deps.fetchBars(deps.toSymbol(ticker));
    } catch (err) {
      summary.failed.push({
        ticker,
        error: err instanceof Error ? err.message : "unknown",
      });
      if (deps.throttleMs) await sleep(deps.throttleMs);
      continue;
    }
    if (deps.throttleMs) await sleep(deps.throttleMs);

    const verdict = assessPriceSeries(bars, prior);
    if (!verdict.ok) {
      summary.skipped.push({ ticker, reason: verdict.reason, stale: verdict.stale });
      continue;
    }

    // History is append-only here (we always fetch from the same start), so
    // anything past the stored high-water mark is what actually lands. Counting
    // every fetched bar would report a fully-covered re-run as thousands of
    // writes that the conflict clause silently discards.
    const lastStored = sec.lastBar ? sec.lastBar.slice(0, 7) : null;
    const newBars = lastStored ? bars.filter((b) => b.date.slice(0, 7) > lastStored) : bars;

    await deps.writeBars(sec.id, bars);
    if (newBars.length > 0) {
      summary.written++;
      summary.barsWritten += newBars.length;
      deps.onProgress?.(`${ticker}: +${newBars.length} bars → ${verdict.lastMonth}`);
    }
  }

  return summary;
}
