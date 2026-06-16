"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOpsAdmin } from "@/lib/ops/ops-auth";
import { createPortalSessionForFirm, extendTrialForFirm } from "@/lib/ops/billing-admin";

export async function openPortalAction(formData: FormData): Promise<void> {
  const admin = await requireOpsAdmin();
  const firmId = String(formData.get("firmId") ?? "");
  if (!firmId) throw new Error("Missing firmId");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
  const url = await createPortalSessionForFirm({
    firmId,
    returnUrl: `${base}/admin/orgs/${firmId}/billing`,
    setBy: admin.clerkUserId,
  });
  redirect(url); // external Stripe portal URL
}

export async function extendTrialAction(formData: FormData): Promise<void> {
  const admin = await requireOpsAdmin();
  const firmId = String(formData.get("firmId") ?? "");
  const days = Number(formData.get("days") ?? "0");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!firmId) throw new Error("Missing firmId");
  if (!reason) throw new Error("A reason is required to extend a trial");
  await extendTrialForFirm({ firmId, days, reason, setBy: admin.clerkUserId });
  revalidatePath(`/admin/orgs/${firmId}/billing`);
}
