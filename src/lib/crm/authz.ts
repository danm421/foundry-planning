import { db } from "@/db";
import { crmHouseholds, crmTasks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError } from "@/lib/authz";
import { hidesPrivateClient, resolveVisibleAdvisorIds, VISIBLE_ALL } from "@/lib/visibility";
import { STAFF_ROLES } from "@/lib/capabilities";
import type { Principal } from "@/lib/clients/authz";
import { callerMaySeeAdvisor } from "@/lib/clients/authz";

// The planning client's Private flag and owner, loaded with the household so
// the household gates apply the same Private rule as the client gates.
const planningClientPrivacy = {
  planningClient: { columns: { isPrivate: true, advisorId: true } },
} as const;

/**
 * The CRM household with this id, if the caller may see it: in the caller's
 * firm (Clerk orgId) and in their book under the rule the clients list and the
 * planning gate use (`callerMaySeeAdvisor`), and not a colleague's Private
 * client. Null for missing and hidden alike, so existence never leaks. Throws
 * only when there is no signed-in org.
 */
export async function findVisibleCrmHousehold(householdId: string) {
  const orgId = await requireOrgId();
  const row = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, householdId), eq(crmHouseholds.firmId, orgId)),
    with: planningClientPrivacy,
  });
  if (!row) return null;
  const { planningClient, ...household } = row;
  const { userId, orgRole } = await auth();
  if (!userId) return null;
  const p = { userId, orgId, orgRole: orgRole ?? null };
  if (hidesPrivateClient(p, planningClient)) return null;
  const visible = await callerMaySeeAdvisor(p, household.advisorId, orgId);
  return visible ? { household, orgId } : null;
}

/**
 * Throwing form of `findVisibleCrmHousehold`. Mirrors `requireClientAccess`.
 * Returns both the row and the firm id so callers can thread them into
 * audit/recordActivity.
 */
export async function requireCrmHouseholdAccess(householdId: string) {
  const access = await findVisibleCrmHousehold(householdId);
  if (!access) {
    throw new Error(`CRM household not found or access denied: ${householdId}`);
  }
  return access;
}

/**
 * Vault access gate. Layered on `requireCrmHouseholdAccess` (which proves the
 * household belongs to the caller's firm), then narrows to the household's
 * *current* assigned advisor OR a firm admin. Because it keys off
 * `household.advisorId`, reassigning a household moves vault access with it.
 */
export async function requireVaultAccess(householdId: string) {
  const { household, orgId } = await requireCrmHouseholdAccess(householdId);
  const { userId, orgRole } = await auth();
  const isAdmin = orgRole === "org:admin";
  if (isAdmin) return { household, orgId };
  if (userId && household.advisorId === userId) return { household, orgId };
  // Staff (operations/planner): allowed iff the household's advisor is in their
  // mapped set. Firm-wide members never reach this branch (STAFF_ROLES gate),
  // so a member still only gets their own assigned households.
  if (userId && orgRole && STAFF_ROLES.has(orgRole)) {
    const visible = await resolveVisibleAdvisorIds(userId, orgRole, orgId);
    if (visible !== VISIBLE_ALL && visible.has(household.advisorId)) {
      return { household, orgId };
    }
  }
  throw new ForbiddenError("You do not have access to this household's vault");
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

/**
 * Principal-taking CRM household check — the MCP doorway's equivalent of
 * `verifyClientAccessFor`.
 *
 * `requireCrmHouseholdAccess` above CANNOT serve this path, for two reasons
 * that both matter: it reads the web session (`requireOrgId()` / `auth()`),
 * which an MCP caller does not have, and it is firm-wide with no advisor
 * narrowing — so it would grant notes on households whose *plans* the same
 * connector refuses to open. That is a weaker gate on more sensitive text.
 *
 * Deliberately NOT mirrored from `verifyClientAccessFor`: the fall-through to
 * `resolveSharedClientAccess`. A cross-firm share is a planning-data concept;
 * a shared client therefore has a readable plan and unreadable notes. Filed in
 * future-work/security-hardening.md rather than decided silently here.
 */
export async function verifyCrmHouseholdAccessFor(
  p: Principal,
  householdId: string,
): Promise<{ ok: false } | { ok: true; firmId: string; advisorId: string }> {
  const household = await db.query.crmHouseholds.findFirst({
    where: eq(crmHouseholds.id, householdId),
    columns: { firmId: true, advisorId: true, deletedAt: true },
    with: planningClientPrivacy,
  });
  // Non-existent, trashed, wrong-firm and private all return the SAME shape,
  // so a caller cannot tell them apart and existence never leaks.
  if (!household || household.deletedAt) return { ok: false };
  if (!p.orgId || household.firmId !== p.orgId) return { ok: false };
  if (hidesPrivateClient(p, household.planningClient)) return { ok: false };
  if (!(await callerMaySeeAdvisor(p, household.advisorId, household.firmId))) return { ok: false };
  return { ok: true, firmId: household.firmId, advisorId: household.advisorId };
}
