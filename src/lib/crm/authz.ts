import { db } from "@/db";
import { crmHouseholds, crmTasks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";

/**
 * Org-scoped accessor for a CRM household. Mirrors the pattern in
 * `requireClientAccess` — fetch the row scoped to the caller's firm
 * (Clerk orgId) and throw if it isn't visible. Returns both the row
 * and the firm id so callers can thread them into audit/recordActivity.
 */
export async function requireCrmHouseholdAccess(householdId: string) {
  const orgId = await requireOrgId();
  const household = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, householdId), eq(crmHouseholds.firmId, orgId)),
  });
  if (!household) {
    throw new Error(`CRM household not found or access denied: ${householdId}`);
  }
  return { household, orgId };
}

/**
 * Org-scoped accessor for a CRM task. Mirrors `requireCrmHouseholdAccess` —
 * fetch the row scoped to the caller's firm (Clerk orgId) and throw if it
 * isn't visible. Returns both the row and the firm id so callers can thread
 * them into audit/recordActivity.
 */
export async function requireCrmTaskAccess(taskId: string) {
  const orgId = await requireOrgId();
  const task = await db.query.crmTasks.findFirst({
    where: and(eq(crmTasks.id, taskId), eq(crmTasks.firmId, orgId)),
  });
  if (!task) {
    throw new Error(`CRM task not found or access denied: ${taskId}`);
  }
  return { task, orgId };
}
