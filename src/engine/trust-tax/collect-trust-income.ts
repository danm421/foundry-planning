import type { TrustIncomeBuckets } from "./types";

export interface AccountYearRealization {
  accountId: string;
  ownerEntityId: string | null;
  ordinary: number;
  dividends: number;
  taxExempt: number;
  capGains: number; // ambient — NOT carried into recognizedCapGains
}

export interface AssetTransactionGain {
  ownerEntityId: string;
  gain: number;
}

export interface CollectTrustIncomeInputs {
  entityIds: string[];
  yearRealizations: AccountYearRealization[];
  assetTransactionGains: AssetTransactionGain[];
}

/**
 * Aggregate trust-level income buckets per entity from the existing
 * realization pipeline + asset-transaction sale events. Ambient cap gains
 * on trust-owned accounts are ignored per the in-kind simplification.
 */
export function collectTrustIncome(
  inp: CollectTrustIncomeInputs,
): Map<string, TrustIncomeBuckets> {
  const byEntity = new Map<string, TrustIncomeBuckets>();
  for (const id of inp.entityIds) {
    byEntity.set(id, { ordinary: 0, dividends: 0, taxExempt: 0, recognizedCapGains: 0 });
  }

  for (const r of inp.yearRealizations) {
    if (r.ownerEntityId === null) continue;
    const bucket = byEntity.get(r.ownerEntityId);
    if (!bucket) continue; // not a target trust
    bucket.ordinary += r.ordinary;
    bucket.dividends += r.dividends;
    bucket.taxExempt += r.taxExempt;
    // ambient capGains deliberately ignored
  }

  for (const g of inp.assetTransactionGains) {
    const bucket = byEntity.get(g.ownerEntityId);
    if (!bucket) continue;
    bucket.recognizedCapGains += g.gain;
  }

  return byEntity;
}
