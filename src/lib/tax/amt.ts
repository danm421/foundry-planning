import { amtPhaseoutRate } from "./constants";
import { calcCapGainsTax } from "./capGains";
import type { CapGainsTier } from "./types";

export interface AmtParams {
  amtExemption: number;
  amtBreakpoint2628: number;
  amtPhaseoutStart: number;
}

/**
 * Tentative minimum tax: AMT calculated on AMTI with exemption (and its phase-out)
 * applied, then 26%/28% rates on the ordinary portion plus preferential
 * (0/15/20%) rates on the LTCG + qualified-dividend portion — this is Form 6251
 * Part III. Skipping Part III inflates AMT for clients with material capital
 * gains (the 26/28% rates get applied to gains that should have been taxed at
 * 0/15/20%).
 *
 * `ltcgPlusQdiv` is the combined long-term capital gains and qualified
 * dividends already included in `amti`. Pass 0 if none.
 *
 * `capGainsBrackets` is the filing-status-specific 0/15/20 thresholds. When
 * omitted, falls back to the old ordinary-only behavior (back-compat for
 * callers that haven't been updated yet).
 *
 * `regularOrdinaryBase` is the regular ordinary taxable base (calculate.ts's
 * `incomeTaxBase`). The 0/15/20% breakpoints are regular taxable-income
 * thresholds, and Form 6251 Part III stacks the preferential amounts on the
 * same regular Schedule D base — NOT on the post-exemption AMTI ordinary
 * portion. Falls back to that ordinary portion when omitted (back-compat).
 */
export function calcAmtTentative(
  amti: number,
  params: AmtParams,
  opts: {
    year: number;
    ltcgPlusQdiv?: number;
    capGainsBrackets?: CapGainsTier;
    regularOrdinaryBase?: number;
  } = { year: new Date().getFullYear() },
): number {
  if (amti <= 0) return 0;
  const phaseoutAmount =
    Math.max(0, amti - params.amtPhaseoutStart) * amtPhaseoutRate(opts.year);
  const reducedExemption = Math.max(0, params.amtExemption - phaseoutAmount);
  const taxableAmti = Math.max(0, amti - reducedExemption);
  if (taxableAmti <= 0) return 0;

  const ltcg = Math.max(0, Math.min(opts.ltcgPlusQdiv ?? 0, taxableAmti));
  const ordinaryAmti = Math.max(0, taxableAmti - ltcg);

  // Part III: ordinary portion taxed at 26/28%, LTCG portion at 0/15/20%.
  const ordinaryPortion =
    ordinaryAmti <= params.amtBreakpoint2628
      ? ordinaryAmti * 0.26
      : params.amtBreakpoint2628 * 0.26 +
        (ordinaryAmti - params.amtBreakpoint2628) * 0.28;

  const capGainsPortion =
    ltcg > 0 && opts.capGainsBrackets
      ? calcCapGainsTax(ltcg, opts.regularOrdinaryBase ?? ordinaryAmti, opts.capGainsBrackets)
      : 0;

  return ordinaryPortion + capGainsPortion;
}

/**
 * Additional tax owed if tentative AMT exceeds regular tax. Otherwise 0.
 */
export function calcAmtAdditional(tentativeAmt: number, regularTax: number): number {
  return Math.max(0, tentativeAmt - regularTax);
}

/**
 * Dollars of AMT below which the charge is rounding noise rather than a
 * regime the advisor should act on. The tentative-minimum comparison is a
 * subtraction of two large numbers, so a client whose two tax figures land
 * within pennies of each other produces a few cents of "AMT" that rounds to
 * "$0 — AMT applies" on screen and paints an amber marker on the year.
 */
export const AMT_APPLIES_THRESHOLD = 1;

/**
 * The single answer to "is this an AMT year?". Every surface that flags,
 * labels, footnotes or suppresses on account of AMT must ask this rather than
 * testing `amtAdditional > 0` itself, so a year cannot read as an AMT year on
 * one screen and an ordinary year on the next.
 */
export function amtApplies(amtAdditional: number | null | undefined): boolean {
  return (amtAdditional ?? 0) >= AMT_APPLIES_THRESHOLD;
}
