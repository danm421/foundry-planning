import { calcCapGainsTax } from "@/lib/tax/capGains";
import { calcNiit } from "@/lib/tax/niit";
import type { CapGainsTier } from "@/lib/tax/types";

export interface TaxableLot {
  marketValue: number;
  costBasis: number;
}

export interface RealizedGain {
  marketValue: number;
  costBasis: number;
  gain: number;
}

export function estimateRealizedGain(lots: readonly TaxableLot[]): RealizedGain {
  const marketValue = lots.reduce((s, l) => s + l.marketValue, 0);
  const costBasis = lots.reduce((s, l) => s + l.costBasis, 0);
  return { marketValue, costBasis, gain: marketValue - costBasis };
}

export interface LtcgRateInputs {
  ordinaryBase: number; // taxResult.flow.incomeTaxBase
  existingLtcg: number; // taxResult.income.capitalGains
  brackets: CapGainsTier; // taxResult.diag.bracketsUsed.capGainsBrackets[fs]
  niit: { magi: number; investmentIncome: number; threshold: number; rate: number };
  incrementalGain: number;
}

/** Marginal effective LTCG rate (federal stacking bracket + NIIT) for the rebalance gain. */
export function deriveEffectiveLtcgRate(i: LtcgRateInputs): number {
  if (i.incrementalGain <= 0) return 0;
  const fedDelta =
    calcCapGainsTax(i.existingLtcg + i.incrementalGain, i.ordinaryBase, i.brackets) -
    calcCapGainsTax(i.existingLtcg, i.ordinaryBase, i.brackets);
  const niitDelta =
    calcNiit({
      ...i.niit,
      magi: i.niit.magi + i.incrementalGain,
      investmentIncome: i.niit.investmentIncome + i.incrementalGain,
    }) - calcNiit(i.niit);
  return (fedDelta + niitDelta) / i.incrementalGain;
}

const NOTE_LT = "Assumes all gains are long-term (no acquisition lots available).";
const NOTE_TAXABLE = "Taxable accounts only; retirement/cash holdings are excluded.";
const NOTE_LOSS = "Liquidated taxable holdings net to a loss — no gains tax (potential loss-harvest).";
const NOTE_STATE = "Federal LTCG + NIIT only; state capital-gains tax not included.";

export interface RebalanceTaxArgs {
  gain: number;
  rate: number;
  rateSource: "engine" | "override";
  taxableMarketValue?: number;
  taxableCostBasis?: number;
}

export interface RebalanceTax {
  taxableMarketValue: number;
  taxableCostBasis: number;
  realizedGain: number;
  effectiveRate: number;
  rateSource: "engine" | "override";
  estimatedTax: number;
  notes: string[];
}

export function estimateRebalanceTax(a: RebalanceTaxArgs): RebalanceTax {
  const notes = [NOTE_TAXABLE, NOTE_LT, NOTE_STATE];
  if (a.gain <= 0) notes.unshift(NOTE_LOSS);
  return {
    taxableMarketValue: a.taxableMarketValue ?? 0,
    taxableCostBasis: a.taxableCostBasis ?? 0,
    realizedGain: a.gain,
    effectiveRate: a.gain > 0 ? a.rate : 0,
    rateSource: a.rateSource,
    estimatedTax: Math.max(0, a.gain) * (a.gain > 0 ? a.rate : 0),
    notes,
  };
}
