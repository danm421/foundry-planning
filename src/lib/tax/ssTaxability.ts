import type { FilingStatus } from "./types";
import { SS_TAXABILITY } from "./constants";

export interface SsTaxabilityInput {
  ssGross: number;
  otherIncome: number;
  taxExemptInterest: number;
  filingStatus: FilingStatus;
}

/**
 * Compute the taxable portion of Social Security benefits using IRS Pub 915.
 * Combined income = otherIncome + 50% × ssGross + taxExemptInterest.
 * Up to 50% of SS is taxable above the first base, up to 85% above the second.
 */
export function calcTaxableSocialSecurity(input: SsTaxabilityInput): number {
  if (input.ssGross <= 0) return 0;

  const base1 = input.filingStatus === "married_joint" ? SS_TAXABILITY.base1.mfj
              : input.filingStatus === "married_separate" ? SS_TAXABILITY.base1.mfs
              : SS_TAXABILITY.base1.single;
  const base2 = input.filingStatus === "married_joint" ? SS_TAXABILITY.base2.mfj
              : input.filingStatus === "married_separate" ? SS_TAXABILITY.base2.mfs
              : SS_TAXABILITY.base2.single;

  const combined = input.otherIncome + 0.5 * input.ssGross + input.taxExemptInterest;
  if (combined <= base1) return 0;

  const cap85 = input.ssGross * 0.85;

  if (combined <= base2) {
    return Math.min(0.5 * (combined - base1), 0.5 * input.ssGross);
  }

  const tier1 = Math.min(0.5 * (base2 - base1), 0.5 * input.ssGross);
  const tier2 = 0.85 * (combined - base2);
  return Math.min(tier1 + tier2, cap85);
}
