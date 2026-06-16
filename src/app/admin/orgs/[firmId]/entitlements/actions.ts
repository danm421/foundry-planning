"use server";

import { revalidatePath } from "next/cache";
import { requireOpsAdmin } from "@/lib/ops/ops-auth";
import { setEntitlementOverride } from "@/lib/ops/entitlements";

export async function toggleEntitlementAction(formData: FormData): Promise<void> {
  const admin = await requireOpsAdmin();
  const firmId = String(formData.get("firmId") ?? "");
  const entitlement = String(formData.get("entitlement") ?? "");
  const mode = String(formData.get("mode") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!firmId || !entitlement || (mode !== "grant" && mode !== "revoke")) {
    throw new Error("Invalid entitlement toggle request");
  }
  if (!reason) throw new Error("A reason is required to change an entitlement");

  await setEntitlementOverride({
    firmId,
    entitlement,
    mode,
    reason,
    setBy: admin.clerkUserId,
  });
  revalidatePath(`/admin/orgs/${firmId}/entitlements`);
}
