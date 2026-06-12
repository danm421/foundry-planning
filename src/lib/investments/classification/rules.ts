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
