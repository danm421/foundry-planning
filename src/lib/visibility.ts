import { db } from "@/db";
import { staffAdvisorVisibility } from "@/db/schema";
import { and, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { STAFF_ROLES } from "./capabilities";

// Sentinel for firm-wide visibility (owner/admin/member). Distinct from a Set
// so callers can cheaply branch on `=== VISIBLE_ALL` and skip scoping entirely.
export const VISIBLE_ALL = "ALL" as const;
export type VisibleAdvisors = typeof VISIBLE_ALL | Set<string>;

/**
 * The set of advisorIds whose book the caller may see. Firm-wide roles get
 * VISIBLE_ALL (no scoping — preserves today's behavior). Staff roles get the
 * concrete set from staff_advisor_visibility; an empty set means "mapped to
 * nobody → sees nothing".
 */
export async function resolveVisibleAdvisorIds(
  userId: string,
  orgRole: string | null | undefined,
  firmId: string,
): Promise<VisibleAdvisors> {
  if (!orgRole || !STAFF_ROLES.has(orgRole)) return VISIBLE_ALL;
  const rows = await db
    .select({ advisorUserId: staffAdvisorVisibility.advisorUserId })
    .from(staffAdvisorVisibility)
    .where(
      and(
        eq(staffAdvisorVisibility.firmId, firmId),
        eq(staffAdvisorVisibility.staffUserId, userId),
      ),
    );
  return new Set(rows.map((r) => r.advisorUserId));
}

/**
 * Turn a VisibleAdvisors result into a Drizzle WHERE condition over an advisorId
 * column. VISIBLE_ALL → undefined (no filter). Empty set → `false` (match
 * nothing). Otherwise → `advisorId IN (...)`.
 */
export function advisorScopeCondition(
  column: AnyColumn,
  visible: VisibleAdvisors,
): SQL | undefined {
  if (visible === VISIBLE_ALL) return undefined;
  const ids = [...visible];
  if (ids.length === 0) return sql`false`;
  return inArray(column, ids);
}
