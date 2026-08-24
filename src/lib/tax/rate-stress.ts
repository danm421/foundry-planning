// src/lib/tax/rate-stress.ts
//
// Stress test — "tax rates rise". Pure transform over a TaxYearParameters row.
// Framework-free, no IO: the resolver calls this inside getYear so every
// projection year, filing status, and Monte Carlo trial sees the same math.
//
// SCOPE, deliberately narrow (see the spec): only `rate` fields move, and only
// on the federal ordinary, federal preferential, and trust schedules. AMT
// (26/28%), NIIT (3.8%), state tax, thresholds, deductions, credits and
// contribution limits are all left alone.

import type { TaxYearParameters, BracketTier, CapGainsTier, FilingStatus } from "./types";

/** IRC §1(h) preferential rates, applied when a tier carries no override. */
export const STATUTORY_MID_RATE = 0.15;
export const STATUTORY_TOP_RATE = 0.20;

/** Ceiling on the dial, as a decimal fraction (0.20 = twenty points). */
export const MAX_RATE_STRESS_POINTS = 0.20;

export interface TaxRateStress {
  /** Percentage POINTS added to every marginal rate, as a decimal fraction:
   *  0.03 takes 22% to 25%. Matches ssBenefitHaircut.pct's convention. */
  points: number;
  /** First projection year the higher rates apply. */
  startYear: number;
}

const FILING_STATUSES: FilingStatus[] =
  ["married_joint", "single", "head_of_household", "married_separate"];

/** Points actually applied: clamped to [0, MAX], and 0 for anything that is
 *  not a usable positive number (NaN from a half-typed input included). */
function effectivePoints(stress: TaxRateStress | undefined): number {
  if (!stress) return 0;
  const p = stress.points;
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.min(p, MAX_RATE_STRESS_POINTS);
}

/** A rate of exactly 0 stays 0 — the zero band on a preferential schedule is
 *  structural ("no tax at the bottom"), not a rate that rises with the others.
 *  Raising it would hand a low-income retiree a capital-gains bill they do not
 *  have today, out of a bracket that exists to say they owe nothing. */
function bump(rate: number, points: number): number {
  if (rate === 0) return 0;
  return rate + points;
}

function bumpTiers(tiers: BracketTier[], points: number): BracketTier[] {
  // `from`/`to` are copied verbatim. projection.ts derives the trust NIIT
  // threshold from trustIncomeBrackets[3].from, so moving a threshold here
  // would silently move a threshold three modules away.
  return tiers.map((t) => ({ from: t.from, to: t.to, rate: bump(t.rate, points) }));
}

function bumpCapGainsTier(tier: CapGainsTier, points: number): CapGainsTier {
  return {
    zeroPctTop: tier.zeroPctTop,
    fifteenPctTop: tier.fifteenPctTop,
    midRate: bump(tier.midRate ?? STATUTORY_MID_RATE, points),
    topRate: bump(tier.topRate ?? STATUTORY_TOP_RATE, points),
  };
}

/**
 * Returns `params` with every federal marginal rate raised by `stress.points`,
 * for projection years at or after `stress.startYear`. Returns the input
 * unchanged (same object) for any earlier year, an absent stressor, or a
 * non-positive points value — callers rely on that to stay allocation-free in
 * the overwhelmingly common unstressed case.
 */
export function applyTaxRateStress(
  params: TaxYearParameters,
  stress: TaxRateStress | undefined,
  year: number,
): TaxYearParameters {
  const points = effectivePoints(stress);
  if (!stress || points === 0 || year < stress.startYear) return params;

  const incomeBrackets = { ...params.incomeBrackets };
  const capGainsBrackets = { ...params.capGainsBrackets };
  for (const fs of FILING_STATUSES) {
    incomeBrackets[fs] = bumpTiers(params.incomeBrackets[fs], points);
    capGainsBrackets[fs] = bumpCapGainsTier(params.capGainsBrackets[fs], points);
  }

  return {
    ...params,
    incomeBrackets,
    capGainsBrackets,
    trustIncomeBrackets: bumpTiers(params.trustIncomeBrackets, points),
    trustCapGainsBrackets: bumpTiers(params.trustCapGainsBrackets, points),
  };
}

/**
 * A cap-gains tier with its preferential rates forced back to statutory.
 *
 * Used at exactly one call site: the AMT hand-off in calculate.ts. AMT is out
 * of scope for this stressor by decision, and because the AMT calculation
 * shares `calcCapGainsTax` with the regular one, stressed rates riding on the
 * params would otherwise reach it for free. Stripping them here keeps amt.ts
 * itself untouched.
 */
export function withStatutoryRates(tier: CapGainsTier): CapGainsTier {
  if (tier.midRate === undefined && tier.topRate === undefined) return tier;
  return { zeroPctTop: tier.zeroPctTop, fifteenPctTop: tier.fifteenPctTop };
}
