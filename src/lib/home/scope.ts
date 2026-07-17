import { cache } from "react";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { accounts, crmHouseholds } from "@/db/schema";
import { advisorScopeCondition, resolveVisibleAdvisorIds } from "@/lib/visibility";
import { AUM_ELIGIBLE_CATEGORIES } from "@/lib/accounts/aum";

/** Task statuses that count as open for the due-this-week KPI and the feed. */
export const OPEN_TASK_STATUSES = ["open", "in_progress", "blocked"] as const;

export type HouseholdConditions = Awaited<
  ReturnType<typeof visibleHouseholdConditions>
>;

/**
 * Household-scoped WHERE conditions shared by the KPI queries and the
 * household-derived feed sources: advisor visibility + firm + not-deleted +
 * active/prospect.
 */
export const visibleHouseholdConditions = cache(async function visibleHouseholdConditions(
  firmId: string,
  userId: string,
  orgRole: string | null | undefined,
) {
  const visible = await resolveVisibleAdvisorIds(userId, orgRole, firmId);
  const scope = advisorScopeCondition(crmHouseholds.advisorId, visible);
  const conditions = [
    eq(crmHouseholds.firmId, firmId),
    isNull(crmHouseholds.deletedAt),
    inArray(crmHouseholds.status, ["active", "prospect"]),
  ];
  if (scope) conditions.push(scope);
  return conditions;
});

/**
 * The account-level filter shared by Total book value / Assets held away and
 * their per-household drill-down: AUM-eligible category within the given
 * visible-household conditions. Callers apply the identical base-case scenario
 * join and household joins; keeping this predicate in one place stops the two
 * loaders from drifting (a category leak here would silently change the book).
 */
export function aumBookWhere(hhConditions: HouseholdConditions) {
  return and(...hhConditions, inArray(accounts.category, [...AUM_ELIGIBLE_CATEGORIES]));
}
