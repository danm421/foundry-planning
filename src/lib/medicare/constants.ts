/** Default Medicare enrollment age — 65 in the US. */
export const DEFAULT_MEDICARE_ENROLLMENT_AGE = 65;

/** National-average defaults used when a household has not entered overrides.
 *  Mid-2025 ballpark values; deliberately conservative-high so the projection
 *  is unlikely to under-estimate. Inflated forward by the household's
 *  medicarePremiumInflationRate. */
export const DEFAULT_MEDIGAP_MONTHLY_AT_BASE_YEAR = 170;     // dollars/mo, Plan G national average
export const DEFAULT_PART_D_PLAN_MONTHLY_AT_BASE_YEAR = 46;  // dollars/mo, national average

/** Year the defaults above are expressed in — used to inflate forward. */
export const DEFAULT_MEDICARE_BASE_YEAR = 2025;

/** Annual rate at which Medicare premiums inflate forward from their base year.
 *  Set as a moderate default close to general CPI; advisors can dial higher
 *  (historical Medicare premium growth has often run 4-6%/yr) per client. */
export const DEFAULT_MEDICARE_PREMIUM_INFLATION_RATE = 0.03;
