// src/engine/socialSecurity/fra.ts
import {
  FRA_TABLE,
  FRA_PRE_1937,
  FRA_POST_1960,
  SURVIVOR_FRA_TABLE,
  SURVIVOR_FRA_PRE_1939,
  SURVIVOR_FRA_POST_1962,
  type FraEntry,
  type SurvivorFraEntry,
} from "./constants";

/**
 * Return the effective birth year for FRA lookups, applying the
 * January-1 rule: a person born on January 1 uses the previous year's
 * FRA (§5.3.1 note). A YYYY-MM-DD string is expected (app convention).
 */
function effectiveBirthYear(dob: string): number {
  const [y, m, d] = dob.split("-").map(Number);
  if (m === 1 && d === 1) return y - 1;
  return y;
}

/**
 * Look up the Full Retirement Age for a worker born on the given date.
 * Applies the January-1 rule (Jan 1 births use the previous year's FRA).
 *
 * @param dob ISO date string in `YYYY-MM-DD` format (validated at entry boundaries).
 */
export function fraForBirthDate(dob: string): FraEntry {
  const year = effectiveBirthYear(dob);
  if (year <= 1937) return FRA_PRE_1937;
  if (year >= 1960) return FRA_POST_1960;
  return FRA_TABLE[year];
}

/**
 * Look up the Survivor FRA for a widow(er) born on the given date.
 * Survivor FRA uses a separate SSA table; see §5.6.2 of the eMoney spec.
 * Applies the January-1 rule.
 *
 * @param dob ISO date string in `YYYY-MM-DD` format (validated at entry boundaries).
 */
export function survivorFraForBirthDate(dob: string): SurvivorFraEntry {
  const year = effectiveBirthYear(dob);
  if (year <= 1939) return SURVIVOR_FRA_PRE_1939;
  if (year >= 1962) return SURVIVOR_FRA_POST_1962;
  return SURVIVOR_FRA_TABLE[year];
}
