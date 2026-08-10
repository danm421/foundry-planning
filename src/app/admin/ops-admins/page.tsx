import { notFound } from "next/navigation";
import { requireOpsAdmin } from "@/lib/ops/ops-auth";
import { listOpsAdmins } from "@/lib/ops/ops-admins";
import OpsAdminsClient, { type AdminRow } from "./ops-admins-client";

export const dynamic = "force-dynamic";

export default async function OpsAdminsPage() {
  // The layout admits any active ops admin; managing who *is* one is
  // superadmin-only. 404 rather than 403, matching the layout's posture.
  let actorId: string;
  try {
    actorId = (await requireOpsAdmin("superadmin")).clerkUserId;
  } catch {
    notFound();
  }

  const rows: AdminRow[] = (await listOpsAdmins()).map((r) => ({
    clerkUserId: r.clerkUserId,
    email: r.email,
    role: r.role,
    disabled: r.disabledAt !== null,
    createdAt: r.createdAt.toISOString(),
    isSelf: r.clerkUserId === actorId,
  }));

  return <OpsAdminsClient rows={rows} />;
}
