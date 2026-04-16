import { AMT_PHASEOUT_RATE } from "./constants";

export interface AmtParams {
  amtExemption: number;
  amtBreakpoint2628: number;
  amtPhaseoutStart: number;
}

/**
 * Tentative minimum tax: AMT calculated on AMTI with exemption (and its phase-out)
 * applied, then 26%/28% rates. Returns 0 if AMTI is below the exemption.
 */
export function calcAmtTentative(amti: number, params: AmtParams): number {
  if (amti <= 0) return 0;
  const phaseoutAmount = Math.max(0, amti - params.amtPhaseoutStart) * AMT_PHASEOUT_RATE;
  const reducedExemption = Math.max(0, params.amtExemption - phaseoutAmount);
  const taxableAmti = Math.max(0, amti - reducedExemption);
  if (taxableAmti <= 0) return 0;
  if (taxableAmti <= params.amtBreakpoint2628) return taxableAmti * 0.26;
  return params.amtBreakpoint2628 * 0.26 + (taxableAmti - params.amtBreakpoint2628) * 0.28;
}

/**
 * Additional tax owed if tentative AMT exceeds regular tax. Otherwise 0.
 */
export function calcAmtAdditional(tentativeAmt: number, regularTax: number): number {
  return Math.max(0, tentativeAmt - regularTax);
}
