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
  | { code: "entity_overdraft"; entityId: string; shortfall: number }
  | { code: "entity_missing_checking"; entityId: string; year: number }
  | { code: "trust_note_cash_shortfall"; entityId: string; year: number; shortfall: number }
  | {
      /** A capped Roth conversion was sized to its ceiling, but the household
       *  still finished the year past that ceiling because another conversion
       *  solved against the same year's income took the same headroom. The
       *  conversion is not wrong; the CAP's promise is the thing that broke,
       *  so the engine says so rather than reporting a cap it did not deliver.
       *  See the `it.todo` in `roth-irmaa-cap.test.ts` for the real fix, which
       *  is blocked on how one household headroom should be split. */
      code: "irmaa_cap_not_enforced";
      year: number;
      conversionId: string;
      /** The tier the advisor asked the conversion to stay within. */
      tier: number;
      /** The MAGI ceiling that tier resolved to for this year's premium year. */
      ceiling: number;
      /** What the household's MAGI actually came out at. Always > `ceiling`. */
      magi: number;
    }
  | {
      code: "engine_iteration_limit";
      year: number;
      residual: number;
      iterations: number;
      /** Per-conversion-id incomeTaxBase residual (actual − ceiling) when the
       *  joint phase-12 loop failed to converge on the bracket axis. Absent or
       *  empty means the bracket axis converged. */
      bracketResiduals?: Record<string, number>;
    };

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
