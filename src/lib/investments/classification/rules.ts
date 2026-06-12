import type { AssetClassSlug } from "../asset-class-slugs";

/** Map a fund's benchmark/category string to a bond asset-class slug.
 *  Order matters — most specific first. Defaults to ten_year_treasury. */
export function classifyBondBenchmark(benchmark: string | undefined): AssetClassSlug {
  const s = (benchmark ?? "").toLowerCase();
  if (/tips|inflation[\s-]?protected/.test(s)) return "tips";
  if (/high[\s-]?yield|junk/.test(s)) return "high_yield_corporate";
  if (/muni|municipal|tax[\s-]?exempt/.test(s)) return "tax_exempt_muni";
  if (/(\b1-3\b|short[\s-]?term|short duration|ultra[\s-]?short)/.test(s)) return "short_term_treasury";
  if (/(long[\s-]?term|20\+|25\+|long treasury|extended duration)/.test(s)) return "long_term_treasury";
  return "ten_year_treasury";
}

/** Money-market / sweep funds. EODHD types these as a fund but rarely returns
 *  an asset-allocation breakdown, so without this guard they fall through to the
 *  inflation residual. They are cash-equivalents for planning → Cash class.
 *  Anchored on the fund name (2a-7 naming is regulated, so "money market" /
 *  "money fund" / "cash reserves" reliably appears), with EODHD type and a
 *  known-ticker fallback for terse payloads. */
const CASH_FUND_TICKERS = new Set([
  "SPAXX", "FDRXX", "SPRXX", "FZFXX", "FDLXX", "FZCXX", "FGXXX",
  "VMFXX", "VMRXX", "VUSXX", "VCTXX",
  "SWVXX", "SNVXX", "SNSXX", "SNAXX", "SWGXX",
]);

export function isCashFund(
  ticker: string | undefined,
  name: string | undefined,
  type: string | undefined,
): boolean {
  const n = (name ?? "").toLowerCase();
  const ty = (type ?? "").toLowerCase();
  if (/money[\s-]?market|money fund\b|cash reserves|cash management/.test(n)) return true;
  if (/money[\s-]?market/.test(ty)) return true;
  return CASH_FUND_TICKERS.has((ticker ?? "").toUpperCase());
}

/** Map a Morningstar category (`raw_payload.General.Category`) to a DEFINITIVE
 *  asset-class slug, or `null` when the category is allocation-reliable (or
 *  empty/unknown) and the caller should fall back to `Asset_Allocation`.
 *
 *  Why: EODHD's Asset_Allocation dumps any fund it can't decompose into a ~100%
 *  Cash "no data" sentinel, so commodity / muni / crypto / currency / ultrashort
 *  and leveraged/inverse funds would be mislabeled as the locked Cash class.
 *  Category is the reliable signal. Tier-2 unmodelable categories return
 *  `inflation` — the editable residual — NEVER `cash`. (Phase 2 will repoint the
 *  genuine-alternatives subset to a new `alternatives` slug.)
 *
 *  Order is most-specific-first. Three traps:
 *   - `muni` before high-yield  → "High Yield Muni" is tax_exempt_muni.
 *   - `trading`/leveraged/inverse before commodity/bond → "Trading--Leveraged
 *      Commodities" / "Trading--Inverse Debt" are inflation, not commodities/bond.
 *   - inflation-protected before short/long → "Short-Term Inflation-Protected
 *      Bond" is tips, not short_term_treasury. */
export function classifyCategory(category: string | undefined): AssetClassSlug | null {
  const c = (category ?? "").toLowerCase().trim();
  if (!c) return null;

  // ── Tier 2: unmodelable → inflation (NEVER cash). Checked first so trading /
  //    derivative variants don't fall through to the asset-class rules below. ──
  if (/trading--|leveraged|inverse/.test(c)) return "inflation";
  if (/digital asset/.test(c) && !/equity digital asset/.test(c)) return "inflation";
  if (/single currency/.test(c)) return "inflation";
  if (/defined outcome|derivative income/.test(c)) return "inflation";
  if (/systematic trend|macro trading|multistrategy|multialternative|event driven|relative value|market neutral|long-short|multi-asset overlay/.test(c)) {
    return "inflation";
  }

  // ── Tier 1: definitive single-class. ──
  if (/money market/.test(c)) return "cash";
  if (/muni/.test(c)) return "tax_exempt_muni";              // before high-yield
  if (/inflation-protected/.test(c)) return "tips";          // before short/long
  if (/ultrashort|short-term bond|short government/.test(c)) return "short_term_treasury";
  if (/long government|long-term bond/.test(c)) return "long_term_treasury";
  if (/high yield bond|bank loan/.test(c)) return "high_yield_corporate";
  if (/emerging markets bond|emerging-markets local-currency bond/.test(c)) return "high_yield_corporate";
  if (/precious metals/.test(c) && !/equity precious metals/.test(c)) return "gold"; // bullion only
  if (/commodit/.test(c)) return "commodities";
  if (/real estate/.test(c)) return "reit";
  if (/preferred stock|convertibles/.test(c)) return "ten_year_treasury";
  // Generic / core bond families → intermediate-bond proxy.
  if (/bond|securitized|mortgage-backed|fixed income|government|direct lending/.test(c)) return "ten_year_treasury";

  // ── Tier 3: allocation-reliable (diversified/sector/regional equity, balanced,
  //    target-date, Equity Hedged/Precious Metals/Digital Assets, MLPs) and
  //    anything unknown → fall back to Asset_Allocation. ──
  return null;
}

/** Detect gold / broad-commodity funds from ticker + name. Returns null if
 *  neither applies (caller treats remaining "Other" as residual → inflation). */
export function classifyCommodityLike(
  ticker: string | undefined,
  name: string | undefined,
): AssetClassSlug | null {
  const t = (ticker ?? "").toUpperCase();
  const n = (name ?? "").toLowerCase();
  if (/\bgold\b/.test(n) || ["GLD", "IAU", "SGOL", "GLDM"].includes(t)) return "gold";
  if (/commodit/.test(n) || ["DBC", "PDBC", "GSG", "BCI", "COMT"].includes(t)) return "commodities";
  return null;
}
