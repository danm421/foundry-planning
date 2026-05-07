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
import type { EntitySummary } from "@/engine/types";

export interface NonGrantorTrustInput {
  entityId: string;
  isGrantorTrust: boolean; // always false for this pass; included for caller convenience
  distributionPolicy: DistributionPolicy;
  incomeBeneficiaries: EntitySummary["incomeBeneficiaries"];
  trustCashStart: number;
  /**
   * §642(c) charitable deduction this year for non-grantor split-interest
   * trusts (CLUT/CLAT post-grantor-death). Forwarded into computeTrustTax
   * which applies it sequentially against retained ordinary → dividends →
   * cap gains. Caller is responsible for only setting this when the trust
   * actually qualifies (non-grantor + split-interest + payment to charity).
   */
  charitableDeduction?: number;
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

    const totalDni = distribution.dniOrdinary + distribution.dniDividends + distribution.dniTaxExempt;
    const routing = routeDni(trust.incomeBeneficiaries, totalDni);

    const householdSharePct = (trust.incomeBeneficiaries ?? [])
      .filter((b) => b.householdRole === "client" || b.householdRole === "spouse")
      .reduce((sum, b) => sum + b.percentage, 0);

    householdIncomeDelta.ordinary  += distribution.dniOrdinary  * householdSharePct / 100;
    householdIncomeDelta.dividends += distribution.dniDividends * householdSharePct / 100;
    householdIncomeDelta.taxExempt += distribution.dniTaxExempt * householdSharePct / 100;

    const nonHouseholdTotal =
      Object.values(routing.toFamilyMember).reduce((s, v) => s + v, 0) +
      Object.values(routing.toExternal).reduce((s, v) => s + v, 0);
    estimatedBeneficiaryTax += nonHouseholdTotal * inp.outOfHouseholdRate;

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
      charitableDeduction: trust.charitableDeduction,
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
