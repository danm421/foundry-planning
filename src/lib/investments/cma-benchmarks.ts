import type { AssetClassSlug } from "./asset-class-slugs";

/**
 * Benchmark/proxy provenance for each canonical CMA asset class, surfaced as a
 * tooltip on the CMA page so advisors can see what the historical return,
 * volatility, and correlation numbers were derived from.
 *
 * `proxy`/`ticker` mirror `PROXY_MAP` in `scripts/recompute-cma.ts`, and `since`
 * mirrors the per-proxy `start` recorded in `cma-defaults.generated.json`
 * (`meta.proxies`). EODHD adjusted-close monthly history is a total-return
 * series (reinvested dividends/splits). Keep all three in sync when the
 * recompute proxies change.
 *
 * `inflation` and `cash` are intentionally absent — `inflation` carries a forward
 * CPI assumption and `cash` is a deterministic 0% bucket, neither a market proxy,
 * so they get no benchmark tooltip.
 */
export interface CmaBenchmark {
  /** The market index the proxy series tracks. */
  index: string;
  /** The instrument used to source the historical series. */
  proxy: string;
  /** EODHD symbol for the proxy. */
  ticker: string;
  /** First month of available monthly history (e.g. "Feb 1996"). */
  since: string;
}

export const CMA_BENCHMARKS: Partial<Record<AssetClassSlug, CmaBenchmark>> = {
  us_large_cap: { index: "S&P 500 Index", proxy: "Vanguard 500 Index Fund", ticker: "VFINX.US", since: "Feb 1996" },
  us_mid_cap: { index: "CRSP US Mid Cap Index", proxy: "Vanguard Mid-Cap Index Fund", ticker: "VIMSX.US", since: "Jul 1998" },
  us_small_cap: { index: "CRSP US Small Cap Index", proxy: "Vanguard Small-Cap Index Fund", ticker: "NAESX.US", since: "Feb 1996" },
  global_ex_us: { index: "FTSE Global All Cap ex US Index", proxy: "Vanguard Total International Stock Index Fund", ticker: "VGTSX.US", since: "Jun 1996" },
  emerging_markets: { index: "FTSE Emerging Markets Index", proxy: "Vanguard Emerging Markets Stock Index Fund", ticker: "VEIEX.US", since: "Feb 1996" },
  short_term_treasury: { index: "Bloomberg US Treasury 1–5 Year Index", proxy: "Vanguard Short-Term Treasury Fund", ticker: "VFISX.US", since: "Feb 1996" },
  ten_year_treasury: { index: "Bloomberg US Treasury 5–10 Year Index", proxy: "Vanguard Intermediate-Term Treasury Fund", ticker: "VFITX.US", since: "Feb 1996" },
  tips: { index: "Bloomberg US Treasury Inflation-Protected Securities (TIPS) Index", proxy: "Vanguard Inflation-Protected Securities Fund", ticker: "VIPSX.US", since: "Aug 2000" },
  high_yield_corporate: { index: "Bloomberg US Corporate High Yield Index", proxy: "Vanguard High-Yield Corporate Fund", ticker: "VWEHX.US", since: "Feb 1996" },
  tax_exempt_muni: { index: "Bloomberg Municipal Bond Index", proxy: "Vanguard Intermediate-Term Tax-Exempt Fund", ticker: "VWITX.US", since: "Feb 1996" },
  long_term_treasury: { index: "Bloomberg US Long Treasury Index", proxy: "Vanguard Long-Term Treasury Fund", ticker: "VUSTX.US", since: "Feb 1996" },
  reit: { index: "MSCI US Investable Market Real Estate 25/50 Index", proxy: "Vanguard Real Estate Index Fund", ticker: "VGSIX.US", since: "Jun 1996" },
  gold: { index: "Spot Gold (USD per ounce)", proxy: "London spot gold price", ticker: "XAUUSD.FOREX", since: "Feb 1996" },
  commodities: { index: "S&P GSCI Index", proxy: "iShares S&P GSCI Commodity-Indexed Trust", ticker: "GSG.US", since: "Aug 2006" },
};

/** One-line benchmark provenance for an asset-class slug, or null when none applies. */
export function benchmarkTooltip(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const b = CMA_BENCHMARKS[slug as AssetClassSlug];
  if (!b) return null;
  return `${b.index} — proxied by ${b.proxy} (${b.ticker}). Monthly total returns since ${b.since}.`;
}
