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

export function fraForBirthDate(dob: string): FraEntry {
  const year = effectiveBirthYear(dob);
  if (year <= 1937) return FRA_PRE_1937;
  if (year >= 1960) return FRA_POST_1960;
  return FRA_TABLE[year];
}

export function survivorFraForBirthDate(dob: string): SurvivorFraEntry {
  const year = effectiveBirthYear(dob);
  if (year <= 1939) return SURVIVOR_FRA_PRE_1939;
  if (year >= 1962) return SURVIVOR_FRA_POST_1962;
  return SURVIVOR_FRA_TABLE[year];
}
