// Pure types for the trust-tax engine module. No Next/DB imports.

export type DistributionMode = "fixed" | "pct_liquid" | "pct_income";

export interface DistributionPolicy {
  mode: DistributionMode | null;
  amount: number | null;          // when mode = fixed
  percent: number | null;          // when mode = pct_*; 0..1 (not 0..100)
  beneficiaryKind: "household" | "non_household" | null;
  beneficiaryFamilyMemberId: string | null;
  beneficiaryExternalId: string | null;
}

export interface TrustIncomeBuckets {
  ordinary: number;
  dividends: number;
  taxExempt: number;
  recognizedCapGains: number;      // ONLY from asset-transaction sales
}

export interface TrustLiquidityPool {
  cash: number;
  taxableBrokerage: number;
  retirementInRmdPhase: number;    // 0 when none in RMD phase
}

export interface DistributionResult {
  targetAmount: number;
  actualAmount: number;              // capped at cash + taxableBrokerage
  drawFromCash: number;
  drawFromTaxable: number;
  dniOrdinary: number;
  dniDividends: number;
  dniTaxExempt: number;
  warnings: TrustWarning[];
}

export type TrustWarning =
  | { code: "trust_distribution_insufficient_liquid"; entityId: string; shortfall: number }
  | { code: "trust_tax_insufficient_cash"; entityId: string; shortfall: number }
  | { code: "entity_overdraft"; entityId: string; shortfall: number };

export interface TrustTaxBreakdown {
  entityId: string;
  retainedOrdinary: number;
  retainedDividends: number;
  recognizedCapGains: number;
  federalOrdinaryTax: number;
  federalCapGainsTax: number;
  niit: number;
  stateTax: number;
  total: number;
}

export interface TrustAnnualPassResult {
  distributionsByEntity: Map<string, DistributionResult>;
  taxByEntity: Map<string, TrustTaxBreakdown>;
  estimatedBeneficiaryTax: number;   // summed flat-rate line
  householdIncomeDelta: {             // added to household tax buckets
    ordinary: number;
    dividends: number;
    taxExempt: number;
  };
  warnings: TrustWarning[];
}
