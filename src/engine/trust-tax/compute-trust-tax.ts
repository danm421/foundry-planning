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
  /**
   * §642(c) charitable deduction for non-grantor split-interest trusts (CLUT/
   * CLAT post-grantor-death). Applied sequentially against retained ordinary,
   * then dividends, then recognized cap gains. Floored at zero — §642(c) does
   * not generate a loss. Caller is responsible for only passing this for
   * trusts that actually qualify (non-grantor split-interest with a current-
   * year payment to charity).
   */
  charitableDeduction?: number;
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
  let { retainedOrdinary, retainedDividends, recognizedCapGains } = inp;
  let remainingDeduction = Math.max(0, inp.charitableDeduction ?? 0);
  if (remainingDeduction > 0) {
    const ordOff = Math.min(retainedOrdinary, remainingDeduction);
    retainedOrdinary -= ordOff;
    remainingDeduction -= ordOff;
  }
  if (remainingDeduction > 0) {
    const divOff = Math.min(retainedDividends, remainingDeduction);
    retainedDividends -= divOff;
    remainingDeduction -= divOff;
  }
  if (remainingDeduction > 0) {
    const cgOff = Math.min(recognizedCapGains, remainingDeduction);
    recognizedCapGains -= cgOff;
    remainingDeduction -= cgOff;
  }

  const totalRetainedOrdinary = retainedOrdinary + retainedDividends;
  const federalOrdinaryTax = calcFederalTax(totalRetainedOrdinary, inp.trustIncomeBrackets);
  const federalCapGainsTax = calcFederalTax(recognizedCapGains, inp.trustCapGainsBrackets);
  const niitBase = Math.max(0, totalRetainedOrdinary + recognizedCapGains - inp.niitThreshold);
  const niit = niitBase * inp.niitRate;
  const stateTax = (totalRetainedOrdinary + recognizedCapGains) * inp.flatStateRate;

  return {
    entityId: inp.entityId,
    retainedOrdinary,
    retainedDividends,
    recognizedCapGains,
    federalOrdinaryTax,
    federalCapGainsTax,
    niit,
    stateTax,
    total: federalOrdinaryTax + federalCapGainsTax + niit + stateTax,
  };
}
