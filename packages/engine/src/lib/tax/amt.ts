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
 */
export function calcAmtTentative(
  amti: number,
  params: AmtParams,
  opts: {
    year: number;
    ltcgPlusQdiv?: number;
    capGainsBrackets?: CapGainsTier;
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
      ? calcCapGainsTax(ltcg, ordinaryAmti, opts.capGainsBrackets)
      : 0;

  return ordinaryPortion + capGainsPortion;
}

/**
 * Additional tax owed if tentative AMT exceeds regular tax. Otherwise 0.
 */
export function calcAmtAdditional(tentativeAmt: number, regularTax: number): number {
  return Math.max(0, tentativeAmt - regularTax);
}
