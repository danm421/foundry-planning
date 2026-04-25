import type { BracketTier } from "@/lib/tax/types";
import { calcFederalTax } from "@/lib/tax/federal";
import type { TrustTaxBreakdown } from "./types";

export interface ComputeTrustTaxInputs {
  entityId: string;
  retainedOrdinary: number;
  retainedDividends: number;
  recognizedCapGains: number;
  trustIncomeBrackets: BracketTier[];
  trustCapGainsBrackets: BracketTier[];
  niitRate: number;
  niitThreshold: number;
  flatStateRate: number;
}

/**
 * Pure federal + state tax on non-grantor trust income.
 * Ordinary + dividends → compressed 1041 brackets.
 * Recognized cap gains → compressed §1(h) brackets.
 * NIIT = niitRate × max(0, retained NII + gains − threshold).
 * State = flatStateRate × (retained ordinary + dividends + gains).
 * Tax-exempt interest (even when retained) is NOT taxed — not in base here.
 */
export function computeTrustTax(inp: ComputeTrustTaxInputs): TrustTaxBreakdown {
  const totalRetainedOrdinary = inp.retainedOrdinary + inp.retainedDividends;
  const federalOrdinaryTax = calcFederalTax(totalRetainedOrdinary, inp.trustIncomeBrackets);
  const federalCapGainsTax = calcFederalTax(inp.recognizedCapGains, inp.trustCapGainsBrackets);
  const niitBase = Math.max(0, totalRetainedOrdinary + inp.recognizedCapGains - inp.niitThreshold);
  const niit = niitBase * inp.niitRate;
  const stateTax = (totalRetainedOrdinary + inp.recognizedCapGains) * inp.flatStateRate;

  return {
    entityId: inp.entityId,
    retainedOrdinary: inp.retainedOrdinary,
    retainedDividends: inp.retainedDividends,
    recognizedCapGains: inp.recognizedCapGains,
    federalOrdinaryTax,
    federalCapGainsTax,
    niit,
    stateTax,
    total: federalOrdinaryTax + federalCapGainsTax + niit + stateTax,
  };
}
