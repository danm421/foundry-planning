// ── RMD (Required Minimum Distributions) ────────────────────────────────────
//
// IRS Uniform Lifetime Table (Publication 590-B) divisors by age.
// Applies to Traditional IRA, 401(k), and similar pre-tax retirement accounts.
// Does NOT apply to Roth IRA or Roth 401(k).

const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2,
  81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7,
  89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4,
  97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9,
  105: 4.6, 106: 4.3, 107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3,
  113: 3.1, 114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
};

/**
 * Determine the RMD start age based on birth year.
 *   - Born 1951-1959: RMD starts at 73
 *   - Born 1960 or later: RMD starts at 75
 */
export function getRmdStartAge(birthYear: number): number {
  return birthYear >= 1960 ? 75 : 73;
}

/**
 * Calculate the Required Minimum Distribution for a given account balance and owner age.
 *
 * Returns 0 if the owner has not yet reached RMD age (based on birth year),
 * or if the balance is zero or negative.
 */
export function calculateRMD(balance: number, age: number, birthYear: number): number {
  if (balance <= 0) return 0;

  const startAge = getRmdStartAge(birthYear);
  if (age < startAge) return 0;

  // For ages beyond the table, use the last entry (age 120)
  const effectiveAge = Math.min(age, 120);
  const divisor = UNIFORM_LIFETIME_TABLE[effectiveAge];

  if (divisor == null || divisor <= 0) return 0;

  return balance / divisor;
}

/** Sub-types that are subject to RMDs (pre-tax retirement accounts). */
export const RMD_ELIGIBLE_SUB_TYPES = new Set([
  "traditional_ira",
  "401k",
]);

/** Check if a sub-type is eligible for RMDs by default. */
export function isRmdEligibleSubType(subType: string): boolean {
  return RMD_ELIGIBLE_SUB_TYPES.has(subType);
}
