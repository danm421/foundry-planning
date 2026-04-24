import { db } from "@/db";
import {
  lifeInsurancePolicies,
  lifeInsuranceCashValueSchedule,
} from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { LifeInsurancePolicy } from "@/engine/types";

/**
 * Loads policy + schedule rows for a set of life-insurance account IDs.
 * Returns a map keyed by account_id containing the engine-facing
 * LifeInsurancePolicy shape with schedule rows attached (sorted by year).
 *
 * Non-policy account IDs are silently ignored — the caller typically
 * pre-filters to `category === "life_insurance"` but this function is
 * defensive against being handed a mixed list.
 */
export async function loadPoliciesByAccountIds(
  accountIds: string[],
): Promise<Record<string, LifeInsurancePolicy>> {
  if (accountIds.length === 0) return {};

  const [policyRows, scheduleRows] = await Promise.all([
    db
      .select()
      .from(lifeInsurancePolicies)
      .where(inArray(lifeInsurancePolicies.accountId, accountIds)),
    db
      .select()
      .from(lifeInsuranceCashValueSchedule)
      .where(inArray(lifeInsuranceCashValueSchedule.policyId, accountIds)),
  ]);

  const scheduleByPolicy = new Map<
    string,
    { year: number; cashValue: number }[]
  >();
  for (const r of scheduleRows) {
    const arr = scheduleByPolicy.get(r.policyId) ?? [];
    arr.push({ year: r.year, cashValue: Number(r.cashValue) });
    scheduleByPolicy.set(r.policyId, arr);
  }
  // Keep schedule rows ordered — downstream consumers assume ascending year.
  for (const arr of scheduleByPolicy.values()) {
    arr.sort((a, b) => a.year - b.year);
  }

  const result: Record<string, LifeInsurancePolicy> = {};
  for (const p of policyRows) {
    result[p.accountId] = {
      faceValue: Number(p.faceValue),
      costBasis: Number(p.costBasis),
      premiumAmount: Number(p.premiumAmount),
      premiumYears: p.premiumYears,
      policyType: p.policyType,
      termIssueYear: p.termIssueYear,
      termLengthYears: p.termLengthYears,
      endsAtInsuredRetirement: p.endsAtInsuredRetirement,
      cashValueGrowthMode: p.cashValueGrowthMode,
      postPayoutMergeAccountId: p.postPayoutMergeAccountId,
      postPayoutGrowthRate: Number(p.postPayoutGrowthRate),
      cashValueSchedule: scheduleByPolicy.get(p.accountId) ?? [],
    };
  }
  return result;
}
