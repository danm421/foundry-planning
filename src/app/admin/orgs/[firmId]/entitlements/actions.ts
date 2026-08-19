"use server";

import { revalidatePath } from "next/cache";
import { requireOpsAdmin } from "@/lib/ops/ops-auth";
import {
  CAPABILITY_KEYS,
  setEntitlementOverride,
  setUserEntitlementOverride,
} from "@/lib/ops/entitlements";

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

export async function toggleUserEntitlementAction(formData: FormData): Promise<void> {
  const admin = await requireOpsAdmin();
  const firmId = String(formData.get("firmId") ?? "");
  const clerkUserId = String(formData.get("clerkUserId") ?? "");
  const entitlement = String(formData.get("entitlement") ?? "");
  const mode = String(formData.get("mode") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!firmId || !clerkUserId || (mode !== "grant" && mode !== "revoke")) {
    throw new Error("Invalid member entitlement toggle request");
  }
  // The storage and the resolution take ANY key, so this gate is the only thing
  // keeping a per-user row off a capability that is meant to stay firm-wide —
  // a per-user `ai_import` revoke would otherwise silently take effect.
  if (!CAPABILITY_KEYS.some((c) => c.key === entitlement && c.perUser)) {
    throw new Error(`${entitlement || "(blank)"} cannot be set per user`);
  }
  if (!reason) throw new Error("A reason is required to change an entitlement");

  await setUserEntitlementOverride({
    firmId,
    clerkUserId,
    entitlement,
    mode,
    reason,
    setBy: admin.clerkUserId,
  });
  revalidatePath(`/admin/orgs/${firmId}/entitlements`);
}
