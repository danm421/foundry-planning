import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { requireClientAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, ForbiddenError } from "@/lib/authz";
import {
  getOrCreateDraft,
  loadWorkbench,
  DivorcePlanError,
} from "@/lib/divorce/divorce-plans";
import DivorceWorkbench from "@/components/divorce/divorce-workbench";

export const dynamic = "force-dynamic";

// The divorce workbench. Data is loaded server-side (getOrCreateDraft +
// loadWorkbench) so the client shell paints with real state on first render —
// no client-side fetch on mount. Visiting this route is the "start a draft"
// action (getOrCreateDraft is idempotent / race-safe), which is why the entry
// card links here with prefetch disabled.
export default async function DivorcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // The client layout already gates access; re-running here yields the firmId +
  // permission and the client row (for the filing-status check). Neither await
  // depends on the other's result, so start both immediately.
  const [access, { userId }] = await Promise.all([requireClientAccess(id), auth()]);

  // Only married households can split into two.
  if (!access.client.filingStatus.startsWith("married_")) {
    redirect(`/clients/${id}/overview`);
  }
  // Creating/opening a draft is a write — view-only (shared) users can't.
  if (access.permission !== "edit" || !userId) {
    redirect(`/clients/${id}/overview`);
  }
  // …and a billable write — gate on an active subscription (mirrors the divorce
  // API routes). The guard throws ForbiddenError on an inactive plan; send the
  // advisor to the overview (whose layout surfaces the subscription banner)
  // rather than error out, matching the redirect convention of the guards above.
  try {
    await requireActiveSubscriptionForFirm(access.firmId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/clients/${id}/overview`);
    }
    throw err;
  }

  let payload;
  try {
    await getOrCreateDraft({ clientId: id, firmId: access.firmId, userId });
    payload = await loadWorkbench({ clientId: id, firmId: access.firmId });
  } catch (err) {
    // not_married / no_spouse_contact / no_draft — the workbench can't build;
    // send the advisor back to the overview rather than error out.
    if (err instanceof DivorcePlanError) {
      redirect(`/clients/${id}/overview`);
    }
    throw err;
  }

  return (
    <div data-fills-viewport className="flex min-h-0 flex-1 flex-col">
      <DivorceWorkbench payload={payload} clientId={id} />
    </div>
  );
}
