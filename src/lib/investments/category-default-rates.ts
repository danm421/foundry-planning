// src/lib/investments/category-default-rates.ts
//
// Per-category default growth rate, as a decimal string, for all ten account
// categories. This is what `AddAccountDialog`'s `categoryDefaults` prop wants.
//
// NAMING TRAP: `GrowthContext.categoryDefaults` in lib/investments/growth-context.ts
// is a DIFFERENT thing with a near-identical name — `{ portfolioName,
// blendedReturnPct }` for taxable/cash/retirement only, used to label the
// dropdown's portfolio options. These two are not interchangeable.
export interface CategoryDefaultSettings {
  growthSourceTaxable?: string;
  modelPortfolioIdTaxable?: string | null;
  defaultGrowthTaxable: string;
  growthSourceCash?: string;
  modelPortfolioIdCash?: string | null;
  defaultGrowthCash: string;
  growthSourceRetirement?: string;
  modelPortfolioIdRetirement?: string | null;
  defaultGrowthRetirement: string;
  growthSourceRealEstate?: string;
  defaultGrowthRealEstate: string;
  growthSourceBusiness?: string;
  defaultGrowthBusiness: string;
  growthSourceStockOptions?: string;
  defaultGrowthStockOptions: string;
  growthSourceLifeInsurance?: string;
  defaultGrowthLifeInsurance: string;
}

// Both a plain string-keyed map (what `Record<string, string>` consumers —
// e.g. the Household Map — expect) and a match for `CategoryDefaults`
// (components/forms/add-account-form.tsx), which the existing Net Worth page
// call site requires verbatim. The explicit keys let it satisfy the latter;
// the index signature lets it satisfy the former without a cast.
export interface CategoryDefaultRateMap {
  [category: string]: string;
  taxable: string;
  cash: string;
  retirement: string;
  education_savings: string;
  annuity: string;
  real_estate: string;
  business: string;
  stock_options: string;
  life_insurance: string;
  notes_receivable: string;
}

// Preserved pre-extraction fallback (net-worth-content.tsx's former ternary,
// settings-falsy branch). This is what the live Net Worth page has shown for
// years when a plan has no `plan_settings` row — an extraction must not
// silently change that to an empty map. See resolutions.md R8.
const FALLBACK_CATEGORY_DEFAULTS: CategoryDefaultRateMap = {
  taxable: "0.07",
  cash: "0.02",
  retirement: "0.07",
  education_savings: "0.07",
  annuity: "0.04",
  real_estate: "0.04",
  business: "0.05",
  stock_options: "0.07",
  life_insurance: "0.03",
  notes_receivable: "0",
};

export function categoryDefaultRates(
  settings: CategoryDefaultSettings | undefined,
  modelPortfolios: readonly { id: string; blendedReturn: number }[],
  resolvedInflationRate: number,
): CategoryDefaultRateMap {
  if (!settings) return FALLBACK_CATEGORY_DEFAULTS;

  const flatRate = (rawRate: string, source: string | undefined): string =>
    source === "inflation" ? String(resolvedInflationRate) : String(rawRate);

  const investableEffectiveRate = (
    source: string | undefined,
    portfolioId: string | null | undefined,
    customRate: string,
  ): string => {
    if (source === "inflation") return String(resolvedInflationRate);
    if (source === "model_portfolio" && portfolioId) {
      const mp = modelPortfolios.find((p) => p.id === portfolioId);
      if (mp) return String(mp.blendedReturn);
    }
    return String(customRate);
  };

  return {
    taxable: investableEffectiveRate(settings.growthSourceTaxable, settings.modelPortfolioIdTaxable, settings.defaultGrowthTaxable),
    cash: investableEffectiveRate(settings.growthSourceCash, settings.modelPortfolioIdCash, settings.defaultGrowthCash),
    retirement: investableEffectiveRate(settings.growthSourceRetirement, settings.modelPortfolioIdRetirement, settings.defaultGrowthRetirement),
    // education_savings aliases the retirement defaults — mirrors
    // `growthDefaultCategory` in the engine's resolver.
    education_savings: investableEffectiveRate(settings.growthSourceRetirement, settings.modelPortfolioIdRetirement, settings.defaultGrowthRetirement),
    annuity: flatRate(settings.defaultGrowthRealEstate, settings.growthSourceRealEstate),
    real_estate: flatRate(settings.defaultGrowthRealEstate, settings.growthSourceRealEstate),
    business: flatRate(settings.defaultGrowthBusiness, settings.growthSourceBusiness),
    stock_options: flatRate(settings.defaultGrowthStockOptions, settings.growthSourceStockOptions),
    life_insurance: flatRate(settings.defaultGrowthLifeInsurance, settings.growthSourceLifeInsurance),
    notes_receivable: "0",
  };
}
