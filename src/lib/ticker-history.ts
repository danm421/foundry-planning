import { type MonthlyBar, type MonthlyReturn, monthlyReturns } from "./cma-stats";
import { fetchMonthlyAdjustedClose } from "./cma-eodhd-history";
import { eodhdSymbol } from "@/lib/investments/quote";

export interface TickerHistoryStore {
  readBars(ticker: string): Promise<MonthlyBar[]>;
  upsertBars(ticker: string, bars: MonthlyBar[]): Promise<void>;
}

export interface LoadOpts {
  /** Current month "YYYY-MM"; cache is stale if it lacks the prior month. */
  asOfMonth: string;
  store: TickerHistoryStore;
  /** Injectable EODHD fetch (defaults to the live monthly endpoint). */
  fetchHistory?: (ticker: string) => Promise<MonthlyBar[]>;
  /** History window start passed to EODHD. */
  from?: string;
}

const FROM_DEFAULT = "1996-01-01";

/** Returns `true` when cached bars already include the most recent closed month. */
function isFresh(bars: MonthlyBar[], asOfMonth: string): boolean {
  if (bars.length === 0) return false;
  const latest = bars.map((b) => b.date.slice(0, 7)).sort().at(-1)!;
  // "prior month" relative to asOfMonth — month-end data lands next business day.
  const [y, m] = asOfMonth.split("-").map(Number);
  const priorDate = new Date(Date.UTC(y, m - 2, 1)); // m is 1-based; m-2 = prior month index
  const prior = `${priorDate.getUTCFullYear()}-${String(priorDate.getUTCMonth() + 1).padStart(2, "0")}`;
  return latest >= prior;
}

export async function loadTickerMonthlyReturns(
  ticker: string,
  opts: LoadOpts,
): Promise<MonthlyReturn[]> {
  const fetchHistory =
    opts.fetchHistory ??
    ((t: string) => fetchMonthlyAdjustedClose(eodhdSymbol(t), { from: opts.from ?? FROM_DEFAULT }));

  let bars = await opts.store.readBars(ticker);
  if (!isFresh(bars, opts.asOfMonth)) {
    const fresh = await fetchHistory(ticker);
    if (fresh.length > 0) {
      await opts.store.upsertBars(ticker, fresh);
      bars = fresh;
    }
  }
  return monthlyReturns(bars);
}
