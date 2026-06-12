/** Stable, human-meaningless identifiers for the 16 canonical asset classes.
 *  The classification layer emits these; a firm's asset_classes.slug column
 *  carries the same values, letting us resolve slug → firm assetClassId. */
export const ASSET_CLASS_SLUGS = [
  "us_large_cap",
  "us_mid_cap",
  "us_small_cap",
  "global_ex_us",
  "emerging_markets",
  "short_term_treasury",
  "ten_year_treasury",
  "tips",
  "high_yield_corporate",
  "tax_exempt_muni",
  "long_term_treasury",
  "reit",
  "gold",
  "commodities",
  "inflation",
  "cash",
] as const;

export type AssetClassSlug = typeof ASSET_CLASS_SLUGS[number];

export function isAssetClassSlug(v: unknown): v is AssetClassSlug {
  return typeof v === "string" && (ASSET_CLASS_SLUGS as readonly string[]).includes(v);
}

/** Maps the canonical display names in DEFAULT_ASSET_CLASSES to their slug. */
export const ASSET_CLASS_NAME_TO_SLUG: Record<string, AssetClassSlug> = {
  "US Large Cap": "us_large_cap",
  "US Mid Cap": "us_mid_cap",
  "US Small Cap": "us_small_cap",
  "Global ex-US Stock Market": "global_ex_us",
  "Emerging Markets": "emerging_markets",
  "Short Term Treasury": "short_term_treasury",
  "10-year Treasury": "ten_year_treasury",
  "TIPS": "tips",
  "High Yield Corporate Bonds": "high_yield_corporate",
  "Intermediate-Term Tax-Exempt": "tax_exempt_muni",
  "Long Term Treasury": "long_term_treasury",
  "REIT": "reit",
  "Gold": "gold",
  "Commodities": "commodities",
  "Inflation": "inflation",
  "Cash": "cash",
};

/** System asset classes whose identity + numbers are fixed and cannot be
 *  edited, deleted, or overridden. Currently just Cash (deterministic 0%). */
export function isLockedSystemAssetClass(slug: string | null | undefined): boolean {
  return slug === "cash";
}
