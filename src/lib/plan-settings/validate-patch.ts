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

  return null;
}
