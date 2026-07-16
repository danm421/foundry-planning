import { eq, inArray, isNull } from "drizzle-orm";
import { crmHouseholds } from "@/db/schema";
import { advisorScopeCondition, resolveVisibleAdvisorIds } from "@/lib/visibility";

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
export async function visibleHouseholdConditions(
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
}
