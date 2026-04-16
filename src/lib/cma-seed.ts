export interface SeedAssetClass {
  name: string;
  geometricReturn: number;
  arithmeticMean: number;
  volatility: number;
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
}

export interface SeedModelPortfolio {
  name: string;
  description: string;
  allocations: { assetClassName: string; weight: number }[];
}

export const DEFAULT_ASSET_CLASSES: SeedAssetClass[] = [
  { name: "US Large Cap", geometricReturn: 0.07, arithmeticMean: 0.085, volatility: 0.15, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0 },
  { name: "US Mid Cap", geometricReturn: 0.075, arithmeticMean: 0.095, volatility: 0.18, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0 },
  { name: "US Small Cap", geometricReturn: 0.08, arithmeticMean: 0.105, volatility: 0.20, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.90, pctQualifiedDividends: 0.10, pctTaxExempt: 0 },
  { name: "Int'l Developed", geometricReturn: 0.065, arithmeticMean: 0.08, volatility: 0.16, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.80, pctQualifiedDividends: 0.20, pctTaxExempt: 0 },
  { name: "Emerging Markets", geometricReturn: 0.075, arithmeticMean: 0.10, volatility: 0.22, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0 },
  { name: "US Aggregate Bond", geometricReturn: 0.035, arithmeticMean: 0.0375, volatility: 0.05, pctOrdinaryIncome: 0.80, pctLtCapitalGains: 0.10, pctQualifiedDividends: 0, pctTaxExempt: 0.10 },
  { name: "US Corporate Bond", geometricReturn: 0.04, arithmeticMean: 0.045, volatility: 0.07, pctOrdinaryIncome: 0.90, pctLtCapitalGains: 0.10, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "US Municipal Bond", geometricReturn: 0.0275, arithmeticMean: 0.03, volatility: 0.05, pctOrdinaryIncome: 0, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 1.0 },
  { name: "TIPS", geometricReturn: 0.025, arithmeticMean: 0.0275, volatility: 0.055, pctOrdinaryIncome: 0.80, pctLtCapitalGains: 0.20, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "REITs", geometricReturn: 0.06, arithmeticMean: 0.08, volatility: 0.18, pctOrdinaryIncome: 0.60, pctLtCapitalGains: 0.15, pctQualifiedDividends: 0.25, pctTaxExempt: 0 },
  { name: "Commodities", geometricReturn: 0.03, arithmeticMean: 0.05, volatility: 0.18, pctOrdinaryIncome: 0, pctLtCapitalGains: 1.0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "Precious Metals", geometricReturn: 0.035, arithmeticMean: 0.055, volatility: 0.19, pctOrdinaryIncome: 0, pctLtCapitalGains: 1.0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "Cash / Money Market", geometricReturn: 0.02, arithmeticMean: 0.02, volatility: 0.005, pctOrdinaryIncome: 1.0, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "High Yield Bond", geometricReturn: 0.05, arithmeticMean: 0.06, volatility: 0.10, pctOrdinaryIncome: 0.85, pctLtCapitalGains: 0.15, pctQualifiedDividends: 0, pctTaxExempt: 0 },
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
