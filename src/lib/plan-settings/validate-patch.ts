// The range checks for a plan-settings patch, shared by `PUT /plan-settings`
// (base) and the autosave hook's scenario path, so a value is refused for the
// same reason in both modes. The benchmark-portfolio firm check needs the DB
// and stays in the route.
import { isUSPSStateCode } from "@/lib/usps-states";

// Mirrors `dependentOverrideEnum` in the schema; the schema module is not
// imported because this file ships in the client bundle with the autosave hook.
const COVERAGE_VALUES: readonly unknown[] = ["auto", "yes", "no"];

/** Fractions that must land in [0, 1]. */
const RATE_KEYS = [
  "flatFederalRate",
  "flatStateRate",
  "flatStateEstateRate",
  "irdTaxRate",
  "probateCostRate",
  "pvDiscountRate",
  "outOfHouseholdDniRate",
  "surplusSpendPct",
  "medicarePremiumInflationRate",
] as const;

/** Dollar amounts that must be finite and non-negative. */
const AMOUNT_KEYS = [
  "estateAdminExpenses",
  "priorTaxableGiftsClient",
  "priorTaxableGiftsSpouse",
  "capitalLossCarryforwardSt",
  "capitalLossCarryforwardLt",
  "lifetimeExemptionCap",
] as const;

// Mirror `growthSourceEnum` and `inflationRateSourceEnum` in the schema, for the
// same reason as `COVERAGE_VALUES`.
const GROWTH_SOURCE_VALUES: readonly unknown[] = [
  "default", "model_portfolio", "ticker_portfolio", "custom", "asset_mix", "inflation", "holdings",
];
const INFLATION_SOURCE_VALUES: readonly unknown[] = ["asset_class", "custom"];

const GROWTH_SOURCE_KEYS = [
  "growthSourceTaxable",
  "growthSourceCash",
  "growthSourceRetirement",
  "growthSourceRealEstate",
  "growthSourceBusiness",
  "growthSourceLifeInsurance",
] as const;

/** Not-null `numeric(5,4)` columns: a present key must be a finite number the
 *  column can hold (|x| < 10). A rate may be negative, so there is no sign
 *  rule. The Medicare premium rate is also in `RATE_KEYS`, which adds 0..1. */
const NEVER_EMPTY_RATE_KEYS = [
  "inflationRate",
  "defaultGrowthTaxable",
  "defaultGrowthCash",
  "defaultGrowthRetirement",
  "defaultGrowthRealEstate",
  "defaultGrowthBusiness",
  "defaultGrowthLifeInsurance",
  "medicarePremiumInflationRate",
] as const;

/** The forms send decimals as strings and the route has always accepted
 *  numbers too, so both are checked; null/undefined mean "unset / don't touch". */
function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** First problem with the patch as a user-facing message, or null when it is
 *  acceptable. */
export function validatePlanSettingsPatch(body: Record<string, unknown>): string | null {
  const { planStartYear, residenceState } = body;

  if (typeof planStartYear === "number") {
    const currentYear = new Date().getFullYear();
    if (planStartYear < currentYear) {
      return `Plan start year cannot be before current year (${currentYear})`;
    }
  }

  if (residenceState !== undefined && residenceState !== null && !isUSPSStateCode(residenceState)) {
    return "residenceState must be a USPS 2-letter code for a US state or DC (or null)";
  }

  // Before the range rules: they read a blank as 0 and a null as "don't touch",
  // and neither is a rate a never-empty column can take.
  for (const key of NEVER_EMPTY_RATE_KEYS) {
    const value = body[key];
    if (value === undefined) continue;
    const blank = value === null || (typeof value === "string" && value.trim() === "");
    const n = blank ? null : finiteNumber(value);
    if (n === null || Math.abs(n) >= 10) return `${key} must be a number`;
  }

  for (const key of RATE_KEYS) {
    const value = body[key];
    if (value == null) continue;
    const n = finiteNumber(value);
    if (n === null || n < 0 || n > 1) return `${key} must be between 0 and 1`;
  }

  for (const key of AMOUNT_KEYS) {
    const value = body[key];
    if (value == null) continue;
    const n = finiteNumber(value);
    if (n === null || n < 0) return `${key} must be a non-negative number`;
  }

  for (const field of ["coveredByWorkplacePlan", "spouseCoveredByWorkplacePlan"] as const) {
    const value = body[field];
    if (value !== undefined && !COVERAGE_VALUES.includes(value)) {
      return `${field} must be 'auto', 'yes', or 'no'`;
    }
  }

  for (const key of GROWTH_SOURCE_KEYS) {
    const value = body[key];
    if (value !== undefined && !GROWTH_SOURCE_VALUES.includes(value)) {
      return `${key} must be one of ${GROWTH_SOURCE_VALUES.join(", ")}`;
    }
  }

  const { inflationRateSource } = body;
  if (inflationRateSource !== undefined && !INFLATION_SOURCE_VALUES.includes(inflationRateSource)) {
    return "inflationRateSource must be one of asset_class, custom";
  }

  return null;
}
