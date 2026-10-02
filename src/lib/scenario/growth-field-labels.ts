// Plain names for the Growth & Inflation keys of a `plan_settings` edit, in ONE
// place: the in-app change describer, the client-facing change report and the
// MCP plan tool all read them, and so does the plan-settings validator's
// messages. A key not named here is not a growth key.

const CATEGORIES = [
  ["Taxable", "taxable"],
  ["Cash", "cash"],
  ["Retirement", "retirement"],
  ["RealEstate", "real estate"],
  ["Business", "business"],
  ["LifeInsurance", "life insurance"],
] as const;

export const GROWTH_FIELD_LABELS: Readonly<Record<string, string>> = {
  inflationRateSource: "Inflation source",
  inflationRate: "Inflation rate",
  taxInflationRate: "Tax inflation rate",
  ssWageGrowthRate: "Social Security wage growth",
  medicarePremiumInflationRate: "Medicare premium inflation rate",
  medicarePremiumInflationEnabled: "Medicare premium inflation",
  ...Object.fromEntries(
    CATEGORIES.flatMap(([key, name]) => [
      [`defaultGrowth${key}`, `Default growth — ${name}`],
      [`growthSource${key}`, `Growth source — ${name}`],
    ]),
  ),
  // Only the three investable categories have a portfolio picker.
  ...Object.fromEntries(
    CATEGORIES.slice(0, 3).map(([key, name]) => [`modelPortfolioId${key}`, `Model portfolio — ${name}`]),
  ),
};

/** Keys whose values are fractions and read as percents. */
export const GROWTH_PERCENT_KEYS: ReadonlySet<string> = new Set([
  "inflationRate",
  "taxInflationRate",
  "ssWageGrowthRate",
  "medicarePremiumInflationRate",
  ...CATEGORIES.map(([key]) => `defaultGrowth${key}`),
]);

export const isGrowthModelPortfolioKey = (key: string): boolean => key.startsWith("modelPortfolioId");

const SOURCE_LABELS: Record<string, string> = {
  asset_class: "Asset class",
  custom: "Custom",
  default: "Default",
  model_portfolio: "Model portfolio",
  ticker_portfolio: "Ticker portfolio",
  asset_mix: "Asset mix",
  inflation: "Inflation",
  holdings: "Holdings",
};

/** A readable name for an enum or boolean value of a growth key, or undefined
 *  when the key has none. */
export function growthEnumLabel(key: string, value: unknown): string | undefined {
  if (key === "medicarePremiumInflationEnabled" && typeof value === "boolean") return value ? "On" : "Off";
  if ((key === "inflationRateSource" || key.startsWith("growthSource")) && typeof value === "string") {
    return SOURCE_LABELS[value];
  }
  return undefined;
}
