"use server";

import { redirect } from "next/navigation";
import { requireOpsAdmin } from "@/lib/ops/ops-auth";
import { startImpersonation } from "@/lib/ops/impersonation";
import { listFirmMembers } from "@/lib/crm-tasks/members";

export async function startImpersonationAction(formData: FormData): Promise<void> {
  const admin = await requireOpsAdmin();
  const firmId = String(formData.get("firmId") ?? "");
  const advisorUserId = String(formData.get("advisorUserId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!firmId || !advisorUserId) throw new Error("Invalid impersonation request");
  if (!reason) throw new Error("A reason is required to impersonate an advisor");

  const members = await listFirmMembers(firmId);
  if (!members.some((m) => m.userId === advisorUserId)) {
    throw new Error("That user is not a member of this organization");
  }

  const url = await startImpersonation({
    firmId,
    advisorUserId,
    opsUserId: admin.clerkUserId,
    reason,
  });
  redirect(url); // Clerk sign-in URL — establishes the impersonated session
}
