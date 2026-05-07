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

// Geometric return + volatility are sourced from a standard 14-asset CMA set.
// Arithmetic mean is derived as `geometric + σ²/2` (the standard log-normal
// convergence) — kept as a stored field because the engine reads it directly.
export const DEFAULT_ASSET_CLASSES: SeedAssetClass[] = [
  { name: "US Large Cap",                geometricReturn: 0.1145, arithmeticMean: 0.1265, volatility: 0.1552, pctOrdinaryIncome: 0,    pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0,   assetType: "equities" },
  { name: "US Mid Cap",                  geometricReturn: 0.1048, arithmeticMean: 0.1205, volatility: 0.1772, pctOrdinaryIncome: 0,    pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0,   assetType: "equities" },
  { name: "US Small Cap",                geometricReturn: 0.1074, arithmeticMean: 0.1269, volatility: 0.1976, pctOrdinaryIncome: 0,    pctLtCapitalGains: 0.90, pctQualifiedDividends: 0.10, pctTaxExempt: 0,   assetType: "equities" },
  { name: "Global ex-US Stock Market",   geometricReturn: 0.0649, arithmeticMean: 0.0804, volatility: 0.1763, pctOrdinaryIncome: 0,    pctLtCapitalGains: 0.80, pctQualifiedDividends: 0.20, pctTaxExempt: 0,   assetType: "equities" },
  { name: "Emerging Markets",            geometricReturn: 0.0681, arithmeticMean: 0.0887, volatility: 0.2031, pctOrdinaryIncome: 0,    pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0,   assetType: "equities" },
  { name: "Short Term Treasury",         geometricReturn: 0.0205, arithmeticMean: 0.0207, volatility: 0.0181, pctOrdinaryIncome: 1.0,  pctLtCapitalGains: 0,    pctQualifiedDividends: 0,    pctTaxExempt: 0,   assetType: "taxable_bonds" },
  { name: "10-year Treasury",            geometricReturn: 0.0323, arithmeticMean: 0.0349, volatility: 0.0725, pctOrdinaryIncome: 1.0,  pctLtCapitalGains: 0,    pctQualifiedDividends: 0,    pctTaxExempt: 0,   assetType: "taxable_bonds" },
  { name: "TIPS",                        geometricReturn: 0.0356, arithmeticMean: 0.0372, volatility: 0.0572, pctOrdinaryIncome: 0.80, pctLtCapitalGains: 0.20, pctQualifiedDividends: 0,    pctTaxExempt: 0,   assetType: "taxable_bonds" },
  { name: "High Yield Corporate Bonds",  geometricReturn: 0.0581, arithmeticMean: 0.0614, volatility: 0.0814, pctOrdinaryIncome: 0.85, pctLtCapitalGains: 0.15, pctQualifiedDividends: 0,    pctTaxExempt: 0,   assetType: "taxable_bonds" },
  { name: "Intermediate-Term Tax-Exempt",geometricReturn: 0.0333, arithmeticMean: 0.0342, volatility: 0.0431, pctOrdinaryIncome: 0,    pctLtCapitalGains: 0,    pctQualifiedDividends: 0,    pctTaxExempt: 1.0, assetType: "tax_exempt_bonds" },
  { name: "Long Term Treasury",          geometricReturn: 0.0388, arithmeticMean: 0.0466, volatility: 0.1252, pctOrdinaryIncome: 1.0,  pctLtCapitalGains: 0,    pctQualifiedDividends: 0,    pctTaxExempt: 0,   assetType: "taxable_bonds" },
  { name: "REIT",                        geometricReturn: 0.0773, arithmeticMean: 0.1021, volatility: 0.2228, pctOrdinaryIncome: 0.60, pctLtCapitalGains: 0.15, pctQualifiedDividends: 0.25, pctTaxExempt: 0,   assetType: "equities" },
  { name: "Gold",                        geometricReturn: 0.1135, arithmeticMean: 0.1283, volatility: 0.1720, pctOrdinaryIncome: 0,    pctLtCapitalGains: 1.0,  pctQualifiedDividends: 0,    pctTaxExempt: 0,   assetType: "other" },
  { name: "Commodities",                 geometricReturn: 0.0195, arithmeticMean: 0.0459, volatility: 0.2298, pctOrdinaryIncome: 0,    pctLtCapitalGains: 1.0,  pctQualifiedDividends: 0,    pctTaxExempt: 0,   assetType: "other" },
  { name: "Inflation", slug: "inflation", geometricReturn: 0.025, arithmeticMean: 0.0255, volatility: 0.005, pctOrdinaryIncome: 1.0, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0, assetType: "other" },
];

export const DEFAULT_MODEL_PORTFOLIOS: SeedModelPortfolio[] = [
  {
    name: "Conservative (30/70)",
    description: "30% equity / 70% fixed income and alternatives",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.15 },
      { assetClassName: "US Mid Cap", weight: 0.05 },
      { assetClassName: "Global ex-US Stock Market", weight: 0.05 },
      { assetClassName: "REIT", weight: 0.05 },
      { assetClassName: "Short Term Treasury", weight: 0.15 },
      { assetClassName: "10-year Treasury", weight: 0.15 },
      { assetClassName: "TIPS", weight: 0.10 },
      { assetClassName: "Intermediate-Term Tax-Exempt", weight: 0.10 },
      { assetClassName: "High Yield Corporate Bonds", weight: 0.15 },
      { assetClassName: "Gold", weight: 0.05 },
    ],
  },
  {
    name: "Balanced (60/40)",
    description: "60% equity / 40% fixed income and alternatives",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.30 },
      { assetClassName: "US Mid Cap", weight: 0.10 },
      { assetClassName: "Global ex-US Stock Market", weight: 0.10 },
      { assetClassName: "Emerging Markets", weight: 0.05 },
      { assetClassName: "REIT", weight: 0.05 },
      { assetClassName: "Short Term Treasury", weight: 0.05 },
      { assetClassName: "10-year Treasury", weight: 0.10 },
      { assetClassName: "TIPS", weight: 0.05 },
      { assetClassName: "Intermediate-Term Tax-Exempt", weight: 0.10 },
      { assetClassName: "High Yield Corporate Bonds", weight: 0.10 },
    ],
  },
  {
    name: "Growth (80/20)",
    description: "80% equity / 20% fixed income and alternatives",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.35 },
      { assetClassName: "US Mid Cap", weight: 0.15 },
      { assetClassName: "US Small Cap", weight: 0.10 },
      { assetClassName: "Global ex-US Stock Market", weight: 0.10 },
      { assetClassName: "Emerging Markets", weight: 0.05 },
      { assetClassName: "REIT", weight: 0.05 },
      { assetClassName: "Short Term Treasury", weight: 0.05 },
      { assetClassName: "10-year Treasury", weight: 0.05 },
      { assetClassName: "High Yield Corporate Bonds", weight: 0.05 },
      { assetClassName: "Gold", weight: 0.05 },
    ],
  },
  {
    name: "Aggressive (100/0)",
    description: "100% equity, no fixed income",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.40 },
      { assetClassName: "US Mid Cap", weight: 0.15 },
      { assetClassName: "US Small Cap", weight: 0.15 },
      { assetClassName: "Global ex-US Stock Market", weight: 0.15 },
      { assetClassName: "Emerging Markets", weight: 0.10 },
      { assetClassName: "REIT", weight: 0.05 },
    ],
  },
];

export interface SeedCorrelation {
  /** Asset-class name as it appears in DEFAULT_ASSET_CLASSES. */
  classA: string;
  classB: string;
  correlation: number;
}

// Pairwise correlations sourced from a standard 14-asset CMA correlation
// matrix. The full upper triangle is enumerated below (91 pairs). Pairs
// omitted default to 0 (independent) when the matrix is reconstructed in
// memory — per the eMoney whitepaper (p.5), a missing pair is treated as
// independent. Inflation is intentionally absent from the matrix; it is
// modeled separately by the engine.
//
// Canonical storage is (classA, classB) with classA < classB alphabetically,
// but the matrix-builder tolerates either ordering, so this list is written
// in matrix (upper-triangle) order for readability.
export const DEFAULT_CORRELATIONS: SeedCorrelation[] = [
  // ── US Large Cap row ─────────────────────────────────────────────────
  { classA: "US Large Cap", classB: "US Mid Cap",                   correlation:  0.95 },
  { classA: "US Large Cap", classB: "US Small Cap",                 correlation:  0.92 },
  { classA: "US Large Cap", classB: "Global ex-US Stock Market",    correlation:  0.86 },
  { classA: "US Large Cap", classB: "Emerging Markets",             correlation:  0.74 },
  { classA: "US Large Cap", classB: "Short Term Treasury",          correlation: -0.04 },
  { classA: "US Large Cap", classB: "10-year Treasury",             correlation: -0.10 },
  { classA: "US Large Cap", classB: "TIPS",                         correlation:  0.32 },
  { classA: "US Large Cap", classB: "High Yield Corporate Bonds",   correlation:  0.73 },
  { classA: "US Large Cap", classB: "Intermediate-Term Tax-Exempt", correlation:  0.26 },
  { classA: "US Large Cap", classB: "Long Term Treasury",           correlation: -0.06 },
  { classA: "US Large Cap", classB: "REIT",                         correlation:  0.75 },
  { classA: "US Large Cap", classB: "Gold",                         correlation:  0.08 },
  { classA: "US Large Cap", classB: "Commodities",                  correlation:  0.44 },

  // ── US Mid Cap row ────────────────────────────────────────────────────
  { classA: "US Mid Cap", classB: "US Small Cap",                 correlation:  0.97 },
  { classA: "US Mid Cap", classB: "Global ex-US Stock Market",    correlation:  0.87 },
  { classA: "US Mid Cap", classB: "Emerging Markets",             correlation:  0.76 },
  { classA: "US Mid Cap", classB: "Short Term Treasury",          correlation: -0.07 },
  { classA: "US Mid Cap", classB: "10-year Treasury",             correlation: -0.11 },
  { classA: "US Mid Cap", classB: "TIPS",                         correlation:  0.34 },
  { classA: "US Mid Cap", classB: "High Yield Corporate Bonds",   correlation:  0.78 },
  { classA: "US Mid Cap", classB: "Intermediate-Term Tax-Exempt", correlation:  0.29 },
  { classA: "US Mid Cap", classB: "Long Term Treasury",           correlation: -0.06 },
  { classA: "US Mid Cap", classB: "REIT",                         correlation:  0.79 },
  { classA: "US Mid Cap", classB: "Gold",                         correlation:  0.11 },
  { classA: "US Mid Cap", classB: "Commodities",                  correlation:  0.46 },

  // ── US Small Cap row ──────────────────────────────────────────────────
  { classA: "US Small Cap", classB: "Global ex-US Stock Market",    correlation:  0.83 },
  { classA: "US Small Cap", classB: "Emerging Markets",             correlation:  0.72 },
  { classA: "US Small Cap", classB: "Short Term Treasury",          correlation: -0.08 },
  { classA: "US Small Cap", classB: "10-year Treasury",             correlation: -0.15 },
  { classA: "US Small Cap", classB: "TIPS",                         correlation:  0.27 },
  { classA: "US Small Cap", classB: "High Yield Corporate Bonds",   correlation:  0.74 },
  { classA: "US Small Cap", classB: "Intermediate-Term Tax-Exempt", correlation:  0.24 },
  { classA: "US Small Cap", classB: "Long Term Treasury",           correlation: -0.10 },
  { classA: "US Small Cap", classB: "REIT",                         correlation:  0.78 },
  { classA: "US Small Cap", classB: "Gold",                         correlation:  0.06 },
  { classA: "US Small Cap", classB: "Commodities",                  correlation:  0.45 },

  // ── Global ex-US Stock Market row ─────────────────────────────────────
  { classA: "Global ex-US Stock Market", classB: "Emerging Markets",             correlation:  0.92 },
  { classA: "Global ex-US Stock Market", classB: "Short Term Treasury",          correlation:  0.05 },
  { classA: "Global ex-US Stock Market", classB: "10-year Treasury",             correlation: -0.04 },
  { classA: "Global ex-US Stock Market", classB: "TIPS",                         correlation:  0.39 },
  { classA: "Global ex-US Stock Market", classB: "High Yield Corporate Bonds",   correlation:  0.76 },
  { classA: "Global ex-US Stock Market", classB: "Intermediate-Term Tax-Exempt", correlation:  0.30 },
  { classA: "Global ex-US Stock Market", classB: "Long Term Treasury",           correlation: -0.02 },
  { classA: "Global ex-US Stock Market", classB: "REIT",                         correlation:  0.71 },
  { classA: "Global ex-US Stock Market", classB: "Gold",                         correlation:  0.25 },
  { classA: "Global ex-US Stock Market", classB: "Commodities",                  correlation:  0.52 },

  // ── Emerging Markets row ──────────────────────────────────────────────
  { classA: "Emerging Markets", classB: "Short Term Treasury",          correlation:  0.02 },
  { classA: "Emerging Markets", classB: "10-year Treasury",             correlation: -0.07 },
  { classA: "Emerging Markets", classB: "TIPS",                         correlation:  0.38 },
  { classA: "Emerging Markets", classB: "High Yield Corporate Bonds",   correlation:  0.70 },
  { classA: "Emerging Markets", classB: "Intermediate-Term Tax-Exempt", correlation:  0.26 },
  { classA: "Emerging Markets", classB: "Long Term Treasury",           correlation: -0.04 },
  { classA: "Emerging Markets", classB: "REIT",                         correlation:  0.61 },
  { classA: "Emerging Markets", classB: "Gold",                         correlation:  0.30 },
  { classA: "Emerging Markets", classB: "Commodities",                  correlation:  0.51 },

  // ── Short Term Treasury row ───────────────────────────────────────────
  { classA: "Short Term Treasury", classB: "10-year Treasury",             correlation:  0.78 },
  { classA: "Short Term Treasury", classB: "TIPS",                         correlation:  0.63 },
  { classA: "Short Term Treasury", classB: "High Yield Corporate Bonds",   correlation:  0.09 },
  { classA: "Short Term Treasury", classB: "Intermediate-Term Tax-Exempt", correlation:  0.47 },
  { classA: "Short Term Treasury", classB: "Long Term Treasury",           correlation:  0.65 },
  { classA: "Short Term Treasury", classB: "REIT",                         correlation:  0.09 },
  { classA: "Short Term Treasury", classB: "Gold",                         correlation:  0.38 },
  { classA: "Short Term Treasury", classB: "Commodities",                  correlation: -0.20 },

  // ── 10-year Treasury row ──────────────────────────────────────────────
  { classA: "10-year Treasury", classB: "TIPS",                         correlation:  0.66 },
  { classA: "10-year Treasury", classB: "High Yield Corporate Bonds",   correlation:  0.03 },
  { classA: "10-year Treasury", classB: "Intermediate-Term Tax-Exempt", correlation:  0.53 },
  { classA: "10-year Treasury", classB: "Long Term Treasury",           correlation:  0.94 },
  { classA: "10-year Treasury", classB: "REIT",                         correlation:  0.10 },
  { classA: "10-year Treasury", classB: "Gold",                         correlation:  0.35 },
  { classA: "10-year Treasury", classB: "Commodities",                  correlation: -0.33 },

  // ── TIPS row ──────────────────────────────────────────────────────────
  { classA: "TIPS", classB: "High Yield Corporate Bonds",   correlation:  0.53 },
  { classA: "TIPS", classB: "Intermediate-Term Tax-Exempt", correlation:  0.54 },
  { classA: "TIPS", classB: "Long Term Treasury",           correlation:  0.63 },
  { classA: "TIPS", classB: "REIT",                         correlation:  0.42 },
  { classA: "TIPS", classB: "Gold",                         correlation:  0.48 },
  { classA: "TIPS", classB: "Commodities",                  correlation:  0.15 },

  // ── High Yield Corporate Bonds row ────────────────────────────────────
  { classA: "High Yield Corporate Bonds", classB: "Intermediate-Term Tax-Exempt", correlation:  0.46 },
  { classA: "High Yield Corporate Bonds", classB: "Long Term Treasury",           correlation:  0.06 },
  { classA: "High Yield Corporate Bonds", classB: "REIT",                         correlation:  0.72 },
  { classA: "High Yield Corporate Bonds", classB: "Gold",                         correlation:  0.22 },
  { classA: "High Yield Corporate Bonds", classB: "Commodities",                  correlation:  0.41 },

  // ── Intermediate-Term Tax-Exempt row ──────────────────────────────────
  { classA: "Intermediate-Term Tax-Exempt", classB: "Long Term Treasury", correlation:  0.55 },
  { classA: "Intermediate-Term Tax-Exempt", classB: "REIT",               correlation:  0.36 },
  { classA: "Intermediate-Term Tax-Exempt", classB: "Gold",               correlation:  0.25 },
  { classA: "Intermediate-Term Tax-Exempt", classB: "Commodities",        correlation: -0.08 },

  // ── Long Term Treasury row ────────────────────────────────────────────
  { classA: "Long Term Treasury", classB: "REIT",        correlation:  0.17 },
  { classA: "Long Term Treasury", classB: "Gold",        correlation:  0.30 },
  { classA: "Long Term Treasury", classB: "Commodities", correlation: -0.34 },

  // ── REIT row ──────────────────────────────────────────────────────────
  { classA: "REIT", classB: "Gold",        correlation:  0.13 },
  { classA: "REIT", classB: "Commodities", correlation:  0.26 },

  // ── Gold row ──────────────────────────────────────────────────────────
  { classA: "Gold", classB: "Commodities", correlation:  0.16 },
];
