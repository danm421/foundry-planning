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
