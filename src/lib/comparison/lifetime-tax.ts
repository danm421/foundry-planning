import type { ProjectionYear } from "@/engine/types";

export interface LifetimeTaxBuckets {
  regularFederalIncomeTax: number;
  capitalGainsTax: number;
  amtAdditional: number;
  niit: number;
  additionalMedicare: number;
  fica: number;
  stateTax: number;
}

export interface LifetimeTaxSummary {
  total: number;
  byBucket: LifetimeTaxBuckets;
}

const BUCKET_KEYS: ReadonlyArray<keyof LifetimeTaxBuckets> = [
  "regularFederalIncomeTax",
  "capitalGainsTax",
  "amtAdditional",
  "niit",
  "additionalMedicare",
  "fica",
  "stateTax",
];

export function sumLifetimeTax(years: ProjectionYear[]): LifetimeTaxSummary {
  const byBucket: LifetimeTaxBuckets = {
    regularFederalIncomeTax: 0, capitalGainsTax: 0, amtAdditional: 0,
    niit: 0, additionalMedicare: 0, fica: 0, stateTax: 0,
  };
  let total = 0;
  for (const year of years) {
    const flow = year.taxResult?.flow;
    if (!flow) continue;
    total += flow.totalTax ?? 0;
    for (const key of BUCKET_KEYS) {
      byBucket[key] += flow[key] ?? 0;
    }
  }
  return { total, byBucket };
}
