// src/engine/socialSecurity/constants.ts

/** Full Retirement Age for retirement benefits, by birth year (§5.3.1). */
export interface FraEntry {
  years: number;
  months: number;
  totalMonths: number; // years*12 + months, precomputed
}

function fra(years: number, months: number): FraEntry {
  return { years, months, totalMonths: years * 12 + months };
}

/**
 * Retirement FRA table. Lookups outside the explicit range fall back to:
 *   year <= 1937 → 65y 0m
 *   year >= 1960 → 67y 0m
 * Callers must apply the January-1 rule separately (use previous year).
 */
export const FRA_TABLE: Record<number, FraEntry> = {
  1937: fra(65, 0),
  1938: fra(65, 2),
  1939: fra(65, 4),
  1940: fra(65, 6),
  1941: fra(65, 8),
  1942: fra(65, 10),
  // 1943-1954 all 66y 0m — filled programmatically below
  1955: fra(66, 2),
  1956: fra(66, 4),
  1957: fra(66, 6),
  1958: fra(66, 8),
  1959: fra(66, 10),
};
for (let y = 1943; y <= 1954; y++) FRA_TABLE[y] = fra(66, 0);

export const FRA_PRE_1937 = fra(65, 0);
export const FRA_POST_1960 = fra(67, 0);

/**
 * Survivor FRA table (§5.6.2). Distinct from retirement FRA — uses a
 * birth-year range shifted -2 years relative to retirement FRA with
 * slight differences. Each entry also precomputes the monthly reduction
 * percentage applied when the survivor claims before survivor-FRA:
 *   monthlyReductionPct = 0.285 / monthsBetween60AndFra
 */
export interface SurvivorFraEntry extends FraEntry {
  /** Months from age 60 to survivor-FRA. */
  monthsFrom60: number;
  /** Per-month reduction fraction when claimed early. */
  monthlyReductionPct: number;
}

function sfra(years: number, months: number): SurvivorFraEntry {
  const totalMonths = years * 12 + months;
  const monthsFrom60 = totalMonths - 60 * 12;
  return {
    years,
    months,
    totalMonths,
    monthsFrom60,
    monthlyReductionPct: 0.285 / monthsFrom60,
  };
}

export const SURVIVOR_FRA_TABLE: Record<number, SurvivorFraEntry> = {
  1939: sfra(65, 0),
  1940: sfra(65, 2),
  1941: sfra(65, 4),
  1942: sfra(65, 6),
  1943: sfra(65, 8),
  1944: sfra(65, 10),
  // 1945-1956 all 66y 0m
  1957: sfra(66, 2),
  1958: sfra(66, 4),
  1959: sfra(66, 6),
  1960: sfra(66, 8),
  1961: sfra(66, 10),
};
for (let y = 1945; y <= 1956; y++) SURVIVOR_FRA_TABLE[y] = sfra(66, 0);

export const SURVIVOR_FRA_PRE_1939 = sfra(65, 0);
export const SURVIVOR_FRA_POST_1962 = sfra(67, 0);

// ── Reduction & DRC factors (§5.3.2–§5.3.4) ──────────────────────────

/** Retirement early reduction: 5/9% per month, first 36 months. */
export const EARLY_RETIREMENT_FIRST_36_PCT_PER_MONTH = 5 / 900; // 0.005556
/** Retirement early reduction: 5/12% per month, months beyond 36. */
export const EARLY_RETIREMENT_EXTENDED_PCT_PER_MONTH = 5 / 1200; // 0.004167

/** Spousal early reduction: 25/36% per month, first 36 months. */
export const EARLY_SPOUSAL_FIRST_36_PCT_PER_MONTH = 25 / 3600; // 0.006944
/** Spousal early reduction: 5/12% per month, months beyond 36 (same as retirement). */
export const EARLY_SPOUSAL_EXTENDED_PCT_PER_MONTH = 5 / 1200;

/** First-tier month count for both retirement and spousal early reductions. */
export const EARLY_REDUCTION_FIRST_TIER_MONTHS = 36;

/** Delayed Retirement Credit: 2/3% per month, capped at age 70 (§5.3.2). */
export const DRC_PCT_PER_MONTH = 2 / 300; // 0.006667

/** Age 70 in total months (upper DRC cap). */
export const AGE_70_MONTHS = 70 * 12;

/** Age 60 in total months (earliest survivor eligibility, §5.6.4). */
export const AGE_60_MONTHS = 60 * 12;

/** Survivor floor: max(deceased's reduced benefit, 82.5% × deceased PIA) (§5.6.5 Case A). */
export const SURVIVOR_FLOOR_PCT_OF_PIA = 0.825;
