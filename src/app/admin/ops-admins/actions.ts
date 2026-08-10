"use server";

import { z } from "zod";
import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { requireOpsAdmin } from "@/lib/ops/ops-auth";
import { addOpsAdmin, updateOpsAdmin, OpsAdminError } from "@/lib/ops/ops-admins";

export type ActionResult = { ok: true } | { ok: false; error: string };

const Role = z.enum(["support", "ops", "superadmin"]);

const AddInput = z.object({
  email: z.string().trim().min(1).email(),
  role: Role,
});

const UpdateInput = z.object({
  clerkUserId: z.string().trim().min(1),
  role: Role,
  disabled: z.boolean(),
});

/**
 * Granting ops access is the one action that can escalate privilege, so it is
 * the first call site to pass a minRole — every other ops action defaults to
 * `support`. Without this a support-tier member could promote themselves to
 * superadmin.
 */
async function requireSuperadmin(): Promise<{ clerkUserId: string } | null> {
  try {
    return await requireOpsAdmin("superadmin");
  } catch {
    return null;
  }
}

function fail(e: unknown): ActionResult {
  // Guard rejections are written for the operator; anything else is a bug and
  // must not have its message echoed into the UI.
  if (e instanceof OpsAdminError) return { ok: false, error: e.message };
  throw e;
}

export async function addOpsAdminAction(input: unknown): Promise<ActionResult> {
  const actor = await requireSuperadmin();
  if (!actor) return { ok: false, error: "Not authorized." };
  const parsed = AddInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email and role." };
  const { email, role } = parsed.data;

  // Ops access is keyed by Clerk user id, so the person must already have an
  // account — there is nothing to attach a row to otherwise.
  const cc = await clerkClient();
  const { data: users } = await cc.users.getUserList({ emailAddress: [email] });
  const user = users[0];
  if (!user) {
    return {
      ok: false,
      error: `No Foundry account for ${email} — they must sign in once before you can grant ops access.`,
    };
  }
  const primary =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? email;

  try {
    await addOpsAdmin({
      clerkUserId: user.id,
      email: primary,
      role,
      actorId: actor.clerkUserId,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin/ops-admins");
  return { ok: true };
}

export async function updateOpsAdminAction(input: unknown): Promise<ActionResult> {
  const actor = await requireSuperadmin();
  if (!actor) return { ok: false, error: "Not authorized." };
  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the values and try again." };

  try {
    await updateOpsAdmin({ ...parsed.data, actorId: actor.clerkUserId });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin/ops-admins");
  return { ok: true };
}
