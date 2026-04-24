import type { AssetTypeId } from "./investments/asset-types";

export interface SeedAssetClass {
  name: string;
  /** Optional stable slug used to look up engine-referenced classes
   * (e.g. "inflation") without relying on a human-edited name. */
  slug?: string;
  geometricReturn: number;
  arithmeticMean: number;
  volatility: number;
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
  assetType: AssetTypeId;
}

export interface SeedModelPortfolio {
  name: string;
  description: string;
  allocations: { assetClassName: string; weight: number }[];
}

export const DEFAULT_ASSET_CLASSES: SeedAssetClass[] = [
  { name: "US Large Cap", geometricReturn: 0.07, arithmeticMean: 0.085, volatility: 0.15, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0, assetType: "equities" },
  { name: "US Mid Cap", geometricReturn: 0.075, arithmeticMean: 0.095, volatility: 0.18, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0, assetType: "equities" },
  { name: "US Small Cap", geometricReturn: 0.08, arithmeticMean: 0.105, volatility: 0.20, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.90, pctQualifiedDividends: 0.10, pctTaxExempt: 0, assetType: "equities" },
  { name: "Int'l Developed", geometricReturn: 0.065, arithmeticMean: 0.08, volatility: 0.16, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.80, pctQualifiedDividends: 0.20, pctTaxExempt: 0, assetType: "equities" },
  { name: "Emerging Markets", geometricReturn: 0.075, arithmeticMean: 0.10, volatility: 0.22, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0, assetType: "equities" },
  { name: "US Aggregate Bond", geometricReturn: 0.035, arithmeticMean: 0.0375, volatility: 0.05, pctOrdinaryIncome: 0.80, pctLtCapitalGains: 0.10, pctQualifiedDividends: 0, pctTaxExempt: 0.10, assetType: "taxable_bonds" },
  { name: "US Corporate Bond", geometricReturn: 0.04, arithmeticMean: 0.045, volatility: 0.07, pctOrdinaryIncome: 0.90, pctLtCapitalGains: 0.10, pctQualifiedDividends: 0, pctTaxExempt: 0, assetType: "taxable_bonds" },
  { name: "US Municipal Bond", geometricReturn: 0.0275, arithmeticMean: 0.03, volatility: 0.05, pctOrdinaryIncome: 0, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 1.0, assetType: "tax_exempt_bonds" },
  { name: "TIPS", geometricReturn: 0.025, arithmeticMean: 0.0275, volatility: 0.055, pctOrdinaryIncome: 0.80, pctLtCapitalGains: 0.20, pctQualifiedDividends: 0, pctTaxExempt: 0, assetType: "taxable_bonds" },
  { name: "REITs", geometricReturn: 0.06, arithmeticMean: 0.08, volatility: 0.18, pctOrdinaryIncome: 0.60, pctLtCapitalGains: 0.15, pctQualifiedDividends: 0.25, pctTaxExempt: 0, assetType: "equities" },
  { name: "Commodities", geometricReturn: 0.03, arithmeticMean: 0.05, volatility: 0.18, pctOrdinaryIncome: 0, pctLtCapitalGains: 1.0, pctQualifiedDividends: 0, pctTaxExempt: 0, assetType: "other" },
  { name: "Precious Metals", geometricReturn: 0.035, arithmeticMean: 0.055, volatility: 0.19, pctOrdinaryIncome: 0, pctLtCapitalGains: 1.0, pctQualifiedDividends: 0, pctTaxExempt: 0, assetType: "other" },
  { name: "Cash / Money Market", geometricReturn: 0.02, arithmeticMean: 0.02, volatility: 0.005, pctOrdinaryIncome: 1.0, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0, assetType: "cash" },
  { name: "High Yield Bond", geometricReturn: 0.05, arithmeticMean: 0.06, volatility: 0.10, pctOrdinaryIncome: 0.85, pctLtCapitalGains: 0.15, pctQualifiedDividends: 0, pctTaxExempt: 0, assetType: "taxable_bonds" },
  { name: "Inflation", slug: "inflation", geometricReturn: 0.025, arithmeticMean: 0.0255, volatility: 0.005, pctOrdinaryIncome: 1.0, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0, assetType: "other" },
];

export const DEFAULT_MODEL_PORTFOLIOS: SeedModelPortfolio[] = [
  {
    name: "Conservative (30/70)",
    description: "30% equity / 70% fixed income and cash",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.15 },
      { assetClassName: "Int'l Developed", weight: 0.05 },
      { assetClassName: "US Aggregate Bond", weight: 0.10 },
      { assetClassName: "US Corporate Bond", weight: 0.20 },
      { assetClassName: "TIPS", weight: 0.10 },
      { assetClassName: "US Municipal Bond", weight: 0.10 },
      { assetClassName: "Cash / Money Market", weight: 0.15 },
      { assetClassName: "High Yield Bond", weight: 0.05 },
      { assetClassName: "REITs", weight: 0.05 },
      { assetClassName: "Precious Metals", weight: 0.05 },
    ],
  },
  {
    name: "Balanced (60/40)",
    description: "60% equity / 40% fixed income and cash",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.30 },
      { assetClassName: "US Mid Cap", weight: 0.10 },
      { assetClassName: "Int'l Developed", weight: 0.10 },
      { assetClassName: "Emerging Markets", weight: 0.05 },
      { assetClassName: "US Aggregate Bond", weight: 0.15 },
      { assetClassName: "US Corporate Bond", weight: 0.10 },
      { assetClassName: "TIPS", weight: 0.05 },
      { assetClassName: "Cash / Money Market", weight: 0.05 },
      { assetClassName: "REITs", weight: 0.05 },
      { assetClassName: "Precious Metals", weight: 0.05 },
    ],
  },
  {
    name: "Growth (80/20)",
    description: "80% equity / 20% fixed income and cash",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.35 },
      { assetClassName: "US Mid Cap", weight: 0.15 },
      { assetClassName: "US Small Cap", weight: 0.10 },
      { assetClassName: "Int'l Developed", weight: 0.10 },
      { assetClassName: "Emerging Markets", weight: 0.05 },
      { assetClassName: "US Aggregate Bond", weight: 0.05 },
      { assetClassName: "US Corporate Bond", weight: 0.05 },
      { assetClassName: "Cash / Money Market", weight: 0.05 },
      { assetClassName: "REITs", weight: 0.05 },
      { assetClassName: "Precious Metals", weight: 0.05 },
    ],
  },
  {
    name: "Aggressive (100/0)",
    description: "100% equity, no fixed income",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.40 },
      { assetClassName: "US Mid Cap", weight: 0.15 },
      { assetClassName: "US Small Cap", weight: 0.15 },
      { assetClassName: "Int'l Developed", weight: 0.15 },
      { assetClassName: "Emerging Markets", weight: 0.10 },
      { assetClassName: "REITs", weight: 0.05 },
    ],
  },
];

export interface SeedCorrelation {
  /** Asset-class name as it appears in DEFAULT_ASSET_CLASSES. */
  classA: string;
  classB: string;
  correlation: number;
}

// Plausible industry-average pairwise correlations for the 14 default asset
// classes. Pairs omitted here default to 0 (independent) when the matrix is
// reconstructed in memory — per the eMoney whitepaper (p.5), a missing pair
// is treated as independent. These are reasonable starting values; advisors
// with better inputs should edit the `asset_class_correlations` table directly
// (a UI is deferred — see docs/FUTURE_WORK.md).
//
// Canonical storage is (classA, classB) with classA < classB alphabetically,
// but the matrix-builder tolerates either ordering, so this list is written
// in the order that reads most naturally.
// Default correlations are sourced from a real-data 13-asset-class correlation
// matrix derived from monthly returns Jan 2007 – Mar 2026. Mapping from matrix
// classes to seed classes:
//   US Aggregate Bond  → "Total US Bond Market" (broad IG aggregate)
//   US Municipal Bond  → "Short-Term Tax-Exempt" (closest available — note that
//                        duration is shorter than a generic muni; correlations
//                        with rates-sensitive assets like TIPS are accordingly
//                        lower than they would be for long-duration munis).
// Cash / Money Market has no row in the matrix and stays at the implicit 0
// (independent) for every pair — industry-standard treatment for cash.
export const DEFAULT_CORRELATIONS: SeedCorrelation[] = [
  // ── Intra-equity (US) ─────────────────────────────────────────────────
  { classA: "US Large Cap", classB: "US Mid Cap", correlation: 0.95 },
  { classA: "US Large Cap", classB: "US Small Cap", correlation: 0.92 },
  { classA: "US Mid Cap",   classB: "US Small Cap", correlation: 0.97 },

  // ── US vs International / EM ──────────────────────────────────────────
  { classA: "US Large Cap",  classB: "Int'l Developed",    correlation: 0.87 },
  { classA: "US Mid Cap",    classB: "Int'l Developed",    correlation: 0.87 },
  { classA: "US Small Cap",  classB: "Int'l Developed",    correlation: 0.83 },
  { classA: "US Large Cap",  classB: "Emerging Markets",   correlation: 0.74 },
  { classA: "US Mid Cap",    classB: "Emerging Markets",   correlation: 0.76 },
  { classA: "US Small Cap",  classB: "Emerging Markets",   correlation: 0.72 },
  { classA: "Int'l Developed", classB: "Emerging Markets", correlation: 0.85 },

  // ── REITs (equity-like, with real-estate flavor) ──────────────────────
  { classA: "US Large Cap",  classB: "REITs", correlation: 0.74 },
  { classA: "US Mid Cap",    classB: "REITs", correlation: 0.79 },
  { classA: "US Small Cap",  classB: "REITs", correlation: 0.78 },
  { classA: "Int'l Developed", classB: "REITs", correlation: 0.72 },
  { classA: "Emerging Markets", classB: "REITs", correlation: 0.60 },

  // ── Intra-bond (investment grade) ─────────────────────────────────────
  { classA: "US Aggregate Bond", classB: "US Corporate Bond", correlation: 0.84 },
  { classA: "US Aggregate Bond", classB: "US Municipal Bond", correlation: 0.67 },
  { classA: "US Aggregate Bond", classB: "TIPS",              correlation: 0.77 },
  { classA: "US Corporate Bond", classB: "US Municipal Bond", correlation: 0.62 },
  { classA: "US Corporate Bond", classB: "TIPS",              correlation: 0.68 },
  { classA: "US Municipal Bond", classB: "TIPS",              correlation: 0.48 },

  // ── High Yield (bond/equity hybrid) ───────────────────────────────────
  { classA: "High Yield Bond", classB: "US Large Cap",   correlation: 0.73 },
  { classA: "High Yield Bond", classB: "US Mid Cap",     correlation: 0.78 },
  { classA: "High Yield Bond", classB: "US Small Cap",   correlation: 0.74 },
  { classA: "High Yield Bond", classB: "Int'l Developed",correlation: 0.75 },
  { classA: "High Yield Bond", classB: "Emerging Markets", correlation: 0.70 },
  { classA: "High Yield Bond", classB: "REITs",          correlation: 0.73 },
  { classA: "High Yield Bond", classB: "US Aggregate Bond", correlation: 0.41 },
  { classA: "High Yield Bond", classB: "US Corporate Bond", correlation: 0.64 },
  { classA: "High Yield Bond", classB: "US Municipal Bond", correlation: 0.36 },
  { classA: "High Yield Bond", classB: "TIPS",           correlation: 0.53 },

  // ── IG bonds vs equities + REITs ─────────────────────────────────────
  { classA: "US Aggregate Bond", classB: "US Large Cap",     correlation: 0.23 },
  { classA: "US Aggregate Bond", classB: "US Mid Cap",       correlation: 0.24 },
  { classA: "US Aggregate Bond", classB: "US Small Cap",     correlation: 0.19 },
  { classA: "US Aggregate Bond", classB: "Int'l Developed",  correlation: 0.31 },
  { classA: "US Aggregate Bond", classB: "Emerging Markets", correlation: 0.26 },
  { classA: "US Aggregate Bond", classB: "REITs",            correlation: 0.38 },
  { classA: "US Corporate Bond", classB: "US Large Cap",     correlation: 0.45 },
  { classA: "US Corporate Bond", classB: "US Mid Cap",       correlation: 0.47 },
  { classA: "US Corporate Bond", classB: "US Small Cap",     correlation: 0.42 },
  { classA: "US Corporate Bond", classB: "Int'l Developed",  correlation: 0.53 },
  { classA: "US Corporate Bond", classB: "Emerging Markets", correlation: 0.45 },
  { classA: "US Corporate Bond", classB: "REITs",            correlation: 0.54 },
  { classA: "US Municipal Bond", classB: "US Large Cap",     correlation: 0.22 },
  { classA: "US Municipal Bond", classB: "US Mid Cap",       correlation: 0.23 },
  { classA: "US Municipal Bond", classB: "US Small Cap",     correlation: 0.20 },
  { classA: "US Municipal Bond", classB: "Int'l Developed",  correlation: 0.26 },
  { classA: "US Municipal Bond", classB: "Emerging Markets", correlation: 0.22 },
  { classA: "US Municipal Bond", classB: "REITs",            correlation: 0.23 },
  { classA: "TIPS", classB: "US Large Cap",     correlation: 0.32 },
  { classA: "TIPS", classB: "US Mid Cap",       correlation: 0.33 },
  { classA: "TIPS", classB: "US Small Cap",     correlation: 0.27 },
  { classA: "TIPS", classB: "Int'l Developed",  correlation: 0.38 },
  { classA: "TIPS", classB: "Emerging Markets", correlation: 0.38 },
  { classA: "TIPS", classB: "REITs",            correlation: 0.42 },

  // ── Commodities ──────────────────────────────────────────────────────
  { classA: "Commodities", classB: "US Large Cap",        correlation: 0.43 },
  { classA: "Commodities", classB: "US Mid Cap",          correlation: 0.45 },
  { classA: "Commodities", classB: "US Small Cap",        correlation: 0.45 },
  { classA: "Commodities", classB: "Int'l Developed",     correlation: 0.49 },
  { classA: "Commodities", classB: "Emerging Markets",    correlation: 0.51 },
  { classA: "Commodities", classB: "REITs",               correlation: 0.26 },
  { classA: "Commodities", classB: "US Aggregate Bond",   correlation: -0.14 },
  { classA: "Commodities", classB: "US Corporate Bond",   correlation: 0.03 },
  { classA: "Commodities", classB: "US Municipal Bond",   correlation: -0.05 },
  { classA: "Commodities", classB: "TIPS",                correlation: 0.15 },
  { classA: "Commodities", classB: "High Yield Bond",     correlation: 0.41 },
  { classA: "Commodities", classB: "Precious Metals",     correlation: 0.33 },

  // ── Precious Metals ──────────────────────────────────────────────────
  { classA: "Precious Metals", classB: "US Large Cap",        correlation: 0.45 },
  { classA: "Precious Metals", classB: "US Mid Cap",          correlation: 0.49 },
  { classA: "Precious Metals", classB: "US Small Cap",        correlation: 0.43 },
  { classA: "Precious Metals", classB: "Int'l Developed",     correlation: 0.58 },
  { classA: "Precious Metals", classB: "Emerging Markets",    correlation: 0.63 },
  { classA: "Precious Metals", classB: "REITs",               correlation: 0.42 },
  { classA: "Precious Metals", classB: "US Aggregate Bond",   correlation: 0.34 },
  { classA: "Precious Metals", classB: "US Corporate Bond",   correlation: 0.42 },
  { classA: "Precious Metals", classB: "US Municipal Bond",   correlation: 0.25 },
  { classA: "Precious Metals", classB: "TIPS",                correlation: 0.45 },
  { classA: "Precious Metals", classB: "High Yield Bond",     correlation: 0.50 },

  // Cash / Money Market is uncorrelated with everything by user direction (= 0).
];
