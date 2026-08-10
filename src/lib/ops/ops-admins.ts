import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opsAdmins } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { OpsRole } from "./ops-auth";

/** A row as the console renders it. `role` is the raw DB text, not `OpsRole`:
 *  ops-auth fails an unrecognized role closed, and the console must still show
 *  such a row so a superadmin can see why that person has no access. */
export type OpsAdminRow = {
  clerkUserId: string;
  email: string;
  role: string;
  disabledAt: Date | null;
  createdAt: Date;
};

/** A rejected change the console should render as a message, not a crash. */
export class OpsAdminError extends Error {}

export const SELF_EDIT_ERROR =
  "You cannot change your own ops access — ask another superadmin.";

/**
 * Self-edit is the one change that can strand the console: demote-self or
 * disable-self takes away the access needed to undo it. Blocking it is also
 * sufficient on its own — the caller is by definition an active superadmin
 * (the page requires it) and stays one, so every permitted change leaves at
 * least one active superadmin standing. No separate "last superadmin" guard.
 */
function assertNotSelf(actorId: string, targetId: string): void {
  if (actorId === targetId) throw new OpsAdminError(SELF_EDIT_ERROR);
}

async function findOpsAdmin(clerkUserId: string): Promise<OpsAdminRow | null> {
  const [row] = await db
    .select()
    .from(opsAdmins)
    .where(eq(opsAdmins.clerkUserId, clerkUserId))
    .limit(1);
  return (row as OpsAdminRow | undefined) ?? null;
}

/** Every ops admin, oldest first — including disabled rows. */
export async function listOpsAdmins(): Promise<OpsAdminRow[]> {
  const rows = await db.select().from(opsAdmins).orderBy(asc(opsAdmins.createdAt));
  return rows as OpsAdminRow[];
}

/** Grant ops-console access to a Clerk user who has none. */
export async function addOpsAdmin(args: {
  clerkUserId: string;
  email: string;
  role: OpsRole;
  actorId: string;
}): Promise<void> {
  const { clerkUserId, email, role, actorId } = args;
  assertNotSelf(actorId, clerkUserId);
  if (await findOpsAdmin(clerkUserId)) {
    throw new OpsAdminError(
      `${email} is already an ops admin — edit the existing row instead.`,
    );
  }
  await db.insert(opsAdmins).values({ clerkUserId, email, role, disabledAt: null });
  await recordAudit({
    action: "ops.admin.added",
    resourceType: "ops_admin",
    resourceId: clerkUserId,
    firmId: "system",
    actorId,
    metadata: { email, role },
  });
}

/** Change a row's tier and/or enabled state. */
export async function updateOpsAdmin(args: {
  clerkUserId: string;
  role: OpsRole;
  disabled: boolean;
  actorId: string;
}): Promise<void> {
  const { clerkUserId, role, disabled, actorId } = args;
  assertNotSelf(actorId, clerkUserId);
  const existing = await findOpsAdmin(clerkUserId);
  if (!existing) throw new OpsAdminError("That ops admin no longer exists — reload the page.");

  // Keep the original timestamp on an already-disabled row so the audit trail
  // still shows when access was actually withdrawn.
  const disabledAt = disabled ? (existing.disabledAt ?? new Date()) : null;
  await db
    .update(opsAdmins)
    .set({ role, disabledAt })
    .where(eq(opsAdmins.clerkUserId, clerkUserId));
  await recordAudit({
    action: "ops.admin.updated",
    resourceType: "ops_admin",
    resourceId: clerkUserId,
    firmId: "system",
    actorId,
    metadata: { email: existing.email, role, disabled, previousRole: existing.role },
  });
}
