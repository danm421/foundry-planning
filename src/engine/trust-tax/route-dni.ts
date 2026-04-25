import type { DistributionPolicy, DistributionResult } from "./types";

export interface RouteDniInputs {
  distributionResult: DistributionResult;
  policy: DistributionPolicy;
  outOfHouseholdRate: number;
}

export interface RouteDniResult {
  householdIncomeDelta: {
    ordinary: number;
    dividends: number;
    taxExempt: number;
  };
  estimatedBeneficiaryTax: number;
}

/**
 * Route DNI to the correct tax bucket. Household beneficiary → additions
 * to the household 1040 (pass-through). Out-of-household → flat-rate
 * informational line (tax-exempt DNI is excluded from the flat-rate base;
 * it's exempt all the way through).
 */
export function routeDni(inp: RouteDniInputs): RouteDniResult {
  const { dniOrdinary, dniDividends, dniTaxExempt } = inp.distributionResult;

  if (inp.policy.mode === null || inp.policy.beneficiaryKind === null) {
    return {
      householdIncomeDelta: { ordinary: 0, dividends: 0, taxExempt: 0 },
      estimatedBeneficiaryTax: 0,
    };
  }

  if (inp.policy.beneficiaryKind === "household") {
    return {
      householdIncomeDelta: {
        ordinary: dniOrdinary,
        dividends: dniDividends,
        taxExempt: dniTaxExempt,
      },
      estimatedBeneficiaryTax: 0,
    };
  }

  // out-of-household
  const taxableDni = dniOrdinary + dniDividends;
  return {
    householdIncomeDelta: { ordinary: 0, dividends: 0, taxExempt: 0 },
    estimatedBeneficiaryTax: taxableDni * inp.outOfHouseholdRate,
  };
}
