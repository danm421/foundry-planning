import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { parseYear } from "@/lib/tax-returns/assemble-analysis";
import { applySuggestion } from "@/lib/tax-reconciliation/apply";

export const dynamic = "force-dynamic";

// Nothing else is read from the body — a client-supplied target is discarded here.
const bodySchema = z.object({
  suggestionId: z.string().min(1),
  amount: z.number().finite().optional(),
  owner: z.enum(["client", "spouse", "split"]).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; taxYear: string }> }) {
  try {
    const { id, taxYear: rawYear } = await params;
    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });
    const { orgId: callerOrgId, userId } = await requireOrgAndUser();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "suggestionId is required; amount must be a number; owner must be client, spouse or split" }, { status: 400 });
    // `access` is deliberately NOT forwarded — applySuggestion resolves its own
    // authoritative access from requireClientEditAccess and would reject an
    // extra field on ApplyArgs at compile time if it were.
    const r = await applySuggestion({ clientId: id, firmId, actorId: userId, callerOrgId, taxYear, ...parsed.data });
    if (!r.ok) return NextResponse.json({ error: r.error, ...(r.reconciliation ? { reconciliation: r.reconciliation } : {}) }, { status: r.status });
    return NextResponse.json({ applied: r.applied, reconciliation: r.reconciliation });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST …/reconcile/apply error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
