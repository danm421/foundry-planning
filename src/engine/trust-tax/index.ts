import type { BracketTier } from "@/lib/tax/types";
import { collectTrustIncome, type AccountYearRealization, type AssetTransactionGain } from "./collect-trust-income";
import { computeDistribution } from "./compute-distribution";
import { routeDni } from "./route-dni";
import { computeTrustTax } from "./compute-trust-tax";
import type {
  DistributionPolicy,
  TrustAnnualPassResult,
  TrustLiquidityPool,
  TrustWarning,
  DistributionResult,
  TrustTaxBreakdown,
} from "./types";

export interface NonGrantorTrustInput {
  entityId: string;
  isGrantorTrust: boolean; // always false for this pass; included for caller convenience
  distributionPolicy: DistributionPolicy;
  trustCashStart: number;
}

export interface ApplyTrustAnnualPassInputs {
  year: number;
  nonGrantorTrusts: NonGrantorTrustInput[];
  yearRealizations: AccountYearRealization[];
  assetTransactionGains: AssetTransactionGain[];
  trustLiquidity: Map<string, TrustLiquidityPool>;
  trustIncomeBrackets: BracketTier[];
  trustCapGainsBrackets: BracketTier[];
  niitRate: number;
  niitThreshold: number;
  flatStateRate: number;
  outOfHouseholdRate: number;
}

export function applyTrustAnnualPass(
  inp: ApplyTrustAnnualPassInputs,
): TrustAnnualPassResult {
  const distributionsByEntity = new Map<string, DistributionResult>();
  const taxByEntity = new Map<string, TrustTaxBreakdown>();
  const warnings: TrustWarning[] = [];
  let estimatedBeneficiaryTax = 0;
  const householdIncomeDelta = { ordinary: 0, dividends: 0, taxExempt: 0 };

  const incomeByEntity = collectTrustIncome({
    entityIds: inp.nonGrantorTrusts.map((t) => t.entityId),
    yearRealizations: inp.yearRealizations,
    assetTransactionGains: inp.assetTransactionGains,
  });

  for (const trust of inp.nonGrantorTrusts) {
    const income = incomeByEntity.get(trust.entityId)!;
    const liquid = inp.trustLiquidity.get(trust.entityId) ?? {
      cash: 0, taxableBrokerage: 0, retirementInRmdPhase: 0,
    };

    const distribution = computeDistribution({
      entityId: trust.entityId,
      policy: trust.distributionPolicy,
      income,
      liquid,
    });
    distributionsByEntity.set(trust.entityId, distribution);
    warnings.push(...distribution.warnings);

    const routing = routeDni({
      distributionResult: distribution,
      policy: trust.distributionPolicy,
      outOfHouseholdRate: inp.outOfHouseholdRate,
    });
    householdIncomeDelta.ordinary += routing.householdIncomeDelta.ordinary;
    householdIncomeDelta.dividends += routing.householdIncomeDelta.dividends;
    householdIncomeDelta.taxExempt += routing.householdIncomeDelta.taxExempt;
    estimatedBeneficiaryTax += routing.estimatedBeneficiaryTax;

    const retainedOrdinary = income.ordinary - distribution.dniOrdinary;
    const retainedDividends = income.dividends - distribution.dniDividends;
    const tax = computeTrustTax({
      entityId: trust.entityId,
      retainedOrdinary,
      retainedDividends,
      recognizedCapGains: income.recognizedCapGains,
      trustIncomeBrackets: inp.trustIncomeBrackets,
      trustCapGainsBrackets: inp.trustCapGainsBrackets,
      niitRate: inp.niitRate,
      niitThreshold: inp.niitThreshold,
      flatStateRate: inp.flatStateRate,
    });
    taxByEntity.set(trust.entityId, tax);
  }

  return {
    distributionsByEntity,
    taxByEntity,
    estimatedBeneficiaryTax,
    householdIncomeDelta,
    warnings,
  };
}
