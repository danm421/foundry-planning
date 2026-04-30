"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireOrgAdminOrOwner } from "@/lib/authz";

const RenameInput = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export type RenameFirmResult =
  | { ok: true; noop?: true; divergenceWarning?: true }
  | { ok: false; error: string };

/**
 * Rename a firm. Sequence:
 *   1. authz (defense in depth)
 *   2. validate
 *   3. read current Clerk name → bail noop on equality
 *   4. Clerk update (source of truth for visible identity)
 *   5. DB update (denormalized firms.display_name)
 *   6. audit log
 *   7. revalidate sidebar/brand header
 *
 * If step 5 fails after step 4 succeeded, we record an audit row with
 * divergence: true so the Phase 3 reconciliation cron can heal.
 * UnauthorizedError / ForbiddenError from step 1 propagate; the page
 * boundary catches them.
 */
export async function renameFirm(formData: FormData): Promise<RenameFirmResult> {
  await requireOrgAdminOrOwner();

  const parsed = RenameInput.safeParse({
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const newName = parsed.data.displayName;

  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return { ok: false, error: "No active org" };
  }

  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: orgId });
  const beforeName = org.name;
  if (beforeName.trim() === newName) {
    return { ok: true, noop: true };
  }

  // Clerk first.
  try {
    await cc.organizations.updateOrganization(orgId, { name: newName });
  } catch (err) {
    console.error("[renameFirm] Clerk update failed:", err);
    return { ok: false, error: "Couldn't save firm name" };
  }

  // DB second. Divergence path on failure.
  let divergence = false;
  try {
    await db
      .update(firms)
      .set({ displayName: newName, updatedAt: new Date() })
      .where(eq(firms.firmId, orgId));
  } catch (err) {
    divergence = true;
    console.error("[renameFirm] DB update failed AFTER Clerk succeeded:", err);
  }

  await recordAudit({
    action: "firm.name_changed",
    resourceType: "firm",
    resourceId: orgId,
    firmId: orgId,
    metadata: {
      before: beforeName,
      after: newName,
      ...(divergence ? { divergence: true } : {}),
    },
  });

  revalidatePath("/", "layout");
  return divergence ? { ok: true, divergenceWarning: true } : { ok: true };
}
