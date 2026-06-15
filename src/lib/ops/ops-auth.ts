import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { opsAdmins } from "@/db/schema";
import { UnauthorizedError } from "@/lib/db-helpers";
import { ForbiddenError } from "@/lib/authz";

export type OpsRole = "support" | "ops" | "superadmin";

const RANK: Record<OpsRole, number> = { support: 1, ops: 2, superadmin: 3 };

export type OpsAdmin = { clerkUserId: string; email: string; role: OpsRole };

/**
 * Resolve the current Clerk user to an active ops_admins row, or null.
 * Null for: no session, no row, or a disabled row. Read-only — use this in
 * UI/render paths that should degrade gracefully (e.g. show/hide nav).
 */
export async function getOpsAdmin(): Promise<OpsAdmin | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const [row] = await db
    .select()
    .from(opsAdmins)
    .where(eq(opsAdmins.clerkUserId, userId))
    .limit(1);
  if (!row || row.disabledAt) return null;
  // Fail safe: an unrecognized role (only reachable if the DB CHECK is ever
  // dropped) is treated as no access, never granted.
  if (!(row.role in RANK)) return null;
  return { clerkUserId: row.clerkUserId, email: row.email, role: row.role as OpsRole };
}

/**
 * Gate for ops-console routes/actions. Throws UnauthorizedError (401) with no
 * session, ForbiddenError (403) when the caller is not an active ops admin or
 * ranks below `minRole`. Returns the resolved admin for audit attribution.
 *
 * v1 callers pass no minRole (default 'support' = any active ops admin). The
 * `minRole` parameter exists so sub-tier enforcement is a one-line change later.
 */
export async function requireOpsAdmin(minRole: OpsRole = "support"): Promise<OpsAdmin> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();
  const admin = await getOpsAdmin();
  if (!admin) throw new ForbiddenError("Ops admin access required");
  // Defensive: never let an undefined rank compare-false into a grant.
  const rank = RANK[admin.role];
  if (rank === undefined || rank < RANK[minRole]) {
    throw new ForbiddenError(`Ops role '${minRole}' required`);
  }
  return admin;
}
