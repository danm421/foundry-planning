import { db } from "@/db";
import { crmHouseholds, crmTasks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError } from "@/lib/authz";

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
 * Vault access gate. Layered on `requireCrmHouseholdAccess` (which proves the
 * household belongs to the caller's firm), then narrows to the household's
 * *current* assigned advisor OR a firm admin/owner. Because it keys off
 * `household.advisorId`, reassigning a household moves vault access with it.
 */
export async function requireVaultAccess(householdId: string) {
  const { household, orgId } = await requireCrmHouseholdAccess(householdId);
  const { userId, orgRole } = await auth();
  const isAdmin = orgRole === "org:admin" || orgRole === "org:owner";
  if (!isAdmin && household.advisorId !== userId) {
    throw new ForbiddenError("You do not have access to this household's vault");
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
