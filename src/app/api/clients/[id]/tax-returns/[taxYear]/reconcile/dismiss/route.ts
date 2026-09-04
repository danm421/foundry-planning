import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { parseYear } from "@/lib/tax-returns/assemble-analysis";
import { computeReconciliation } from "@/lib/tax-reconciliation/reconcile";
import { LOAD_FAILURE_STATUS } from "@/lib/tax-reconciliation/load-input";
import { addDismissal, removeDismissal } from "@/lib/tax-reconciliation/dismissals-store";
import type { Reconciliation } from "@/lib/tax-reconciliation/types";

export const dynamic = "force-dynamic";
const bodySchema = z.object({ suggestionId: z.string().min(1) });

/** True when `id` names a suggestion, check, or already-dismissed item this reconciliation
 *  actually produced — mode-agnostic on purpose (a dismiss id and a restore id are drawn
 *  from different arrays, but both must be REAL). Without this, an edit-access advisor could
 *  persist any string into the (unbounded, unvalidated) dismissals table. `before` is already
 *  in hand for the year check, so this costs nothing extra to compute. */
function isKnownSuggestionId(r: Reconciliation, id: string): boolean {
  return r.sections.some((s) => s.items.some((item) => item.id === id)) || r.checks.some((c) => c.id === id) || r.dismissed.some((d) => d.id === id);
}

async function handle(request: NextRequest, params: Promise<{ id: string; taxYear: string }>, mode: "dismiss" | "restore") {
  try {
    const { id, taxYear: rawYear } = await params;
    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });
    const { orgId: callerOrgId, userId } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "suggestionId is required" }, { status: 400 });
    const { suggestionId } = parsed.data;

    // The first compute is only for the return's id and to prove the year exists;
    // the second returns the post-write bundle the page renders.
    const before = await computeReconciliation(id, firmId, taxYear);
    if (!before.ok) return NextResponse.json({ error: before.code, message: before.message }, { status: LOAD_FAILURE_STATUS[before.code] });
    if (!isKnownSuggestionId(before.reconciliation, suggestionId)) return NextResponse.json({ error: "Unknown suggestion" }, { status: 404 });
    const outcome = mode === "dismiss" ? await addDismissal(before.taxReturnId, suggestionId, userId) : await removeDismissal(before.taxReturnId, suggestionId);
    if (outcome === "unavailable") return NextResponse.json({ error: "dismissals_unavailable" }, { status: 503 });

    await recordAudit({ action: mode === "dismiss" ? "tax_reconciliation.dismiss" : "tax_reconciliation.restore", resourceType: "tax_return", resourceId: `${id}:${taxYear}`, clientId: id, firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrgId, { taxYear, suggestionId }) });
    const after = await computeReconciliation(id, firmId, taxYear);
    return NextResponse.json({ reconciliation: after.ok ? after.reconciliation : before.reconciliation });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(`${mode} …/reconcile/dismiss error:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; taxYear: string }> }) { return handle(request, params, "dismiss"); }
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; taxYear: string }> }) { return handle(request, params, "restore"); }
