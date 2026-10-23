import { db } from "@/db";
import {
  accounts,
  lifeInsurancePolicies,
  lifeInsuranceCashValueSchedule,
} from "@/db/schema";
import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import type { LifeInsurancePolicy } from "@/engine/types";

/**
 * Loads policy + schedule rows for a set of life-insurance account IDs.
 * Returns a map keyed by account_id containing the engine-facing
 * LifeInsurancePolicy shape with schedule rows attached (sorted by year).
 *
 * Non-policy account IDs are silently ignored — the caller typically
 * pre-filters to `category === "life_insurance"` but this function is
 * defensive against being handed a mixed list. So is an account that isn't
 * `clientId`'s: the ids can come from a tree carrying the Solver's held adds,
 * which name any id a request does.
 */
export async function loadPoliciesByAccountIds(
  accountIds: string[],
  clientId: string,
): Promise<Record<string, LifeInsurancePolicy>> {
  if (accountIds.length === 0) return {};

  const ownAccount = (accountIdColumn: typeof lifeInsurancePolicies.accountId | typeof lifeInsuranceCashValueSchedule.policyId) =>
    and(inArray(accountIdColumn, accountIds), eq(accounts.clientId, clientId));
  const [policyRows, scheduleRows] = await Promise.all([
    db
      .select(getTableColumns(lifeInsurancePolicies))
      .from(lifeInsurancePolicies)
      .innerJoin(accounts, eq(accounts.id, lifeInsurancePolicies.accountId))
      .where(ownAccount(lifeInsurancePolicies.accountId)),
    db
      .select(getTableColumns(lifeInsuranceCashValueSchedule))
      .from(lifeInsuranceCashValueSchedule)
      .innerJoin(accounts, eq(accounts.id, lifeInsuranceCashValueSchedule.policyId))
      .where(ownAccount(lifeInsuranceCashValueSchedule.policyId)),
  ]);

  const scheduleByPolicy = new Map<
    string,
    {
      year: number;
      cashValue?: number;
      premiumAmount?: number;
      income?: number;
      deathBenefit?: number;
    }[]
  >();
  const num = (v: string | null) => (v == null ? undefined : Number(v));
  for (const r of scheduleRows) {
    const arr = scheduleByPolicy.get(r.policyId) ?? [];
    arr.push({
      year: r.year,
      cashValue: num(r.cashValue),
      premiumAmount: num(r.premiumAmount),
      income: num(r.income),
      deathBenefit: num(r.deathBenefit),
    });
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
      premiumPayer: p.premiumPayer,
      policyType: p.policyType,
      termIssueYear: p.termIssueYear,
      termLengthYears: p.termLengthYears,
      endsAtInsuredRetirement: p.endsAtInsuredRetirement,
      cashValueGrowthMode: p.cashValueGrowthMode,
      premiumScheduleMode: p.premiumScheduleMode,
      deathBenefitScheduleMode: p.deathBenefitScheduleMode,
      incomeScheduleMode: p.incomeScheduleMode,
      postPayoutGrowthRate: Number(p.postPayoutGrowthRate),
      postPayoutModelPortfolioId: p.postPayoutModelPortfolioId,
      cashValueSchedule: scheduleByPolicy.get(p.accountId) ?? [],
    };
  }
  return result;
}
