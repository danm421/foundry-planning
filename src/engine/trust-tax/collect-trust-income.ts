import type { IncomeTaxType } from "@/engine/tax-adjustments";
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

export const emptyTrustIncomeBuckets = (): TrustIncomeBuckets => ({
  ordinary: 0,
  dividends: 0,
  taxExempt: 0,
  recognizedCapGains: 0,
});

/**
 * Income a trust receives outside its accounts' realization models — an
 * income row it owns (rent, royalties, a business interest) or the taxable
 * slice of an RMD from a retirement account it owns. Received in cash, so
 * every bucket here is recognized this year (unlike a realization row's
 * ambient `capGains`).
 */
export type TrustIncomeRow = TrustIncomeBuckets & { ownerEntityId: string };

export function trustIncomeRow(
  ownerEntityId: string,
  bucket: keyof TrustIncomeBuckets,
  amount: number,
): TrustIncomeRow {
  const row: TrustIncomeRow = { ownerEntityId, ...emptyTrustIncomeBuckets() };
  row[bucket] = amount;
  return row;
}

/**
 * Which 1041 bucket an income row's tax type lands in. Coarser than the
 * household 1040's eight fields on purpose: STCG and QBI are plain ordinary
 * income to a trust (no §199A at the 1041 level yet); muni interest is income
 * the 1041 does not tax; a `tax_exempt` row (an inheritance, a benefit payout)
 * is not income at all → null.
 */
const TRUST_BUCKET_BY_TAX_TYPE = {
  earned_income: "ordinary",
  ordinary_income: "ordinary",
  stcg: "ordinary",
  qbi: "ordinary",
  dividends: "dividends",
  capital_gains: "recognizedCapGains",
  muni_interest: "taxExempt",
  tax_exempt: null,
} as const satisfies Record<IncomeTaxType, keyof TrustIncomeBuckets | null>;

export function trustIncomeRowFor(
  ownerEntityId: string,
  taxType: IncomeTaxType,
  amount: number,
): TrustIncomeRow | null {
  const bucket = TRUST_BUCKET_BY_TAX_TYPE[taxType];
  return bucket == null ? null : trustIncomeRow(ownerEntityId, bucket, amount);
}

export interface CollectTrustIncomeInputs {
  entityIds: string[];
  yearRealizations: AccountYearRealization[];
  assetTransactionGains: AssetTransactionGain[];
  trustIncomeRows?: TrustIncomeRow[];
}

/**
 * Aggregate trust-level income buckets per entity from the existing
 * realization pipeline + asset-transaction sale events + income the trust
 * receives directly (owned income rows, entity RMDs). Ambient cap gains on
 * trust-owned accounts are ignored per the in-kind simplification.
 */
export function collectTrustIncome(
  inp: CollectTrustIncomeInputs,
): Map<string, TrustIncomeBuckets> {
  const byEntity = new Map<string, TrustIncomeBuckets>();
  for (const id of inp.entityIds) {
    byEntity.set(id, emptyTrustIncomeBuckets());
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

  for (const r of inp.trustIncomeRows ?? []) {
    const bucket = byEntity.get(r.ownerEntityId);
    if (!bucket) continue;
    bucket.ordinary += r.ordinary;
    bucket.dividends += r.dividends;
    bucket.taxExempt += r.taxExempt;
    bucket.recognizedCapGains += r.recognizedCapGains;
  }

  return byEntity;
}
