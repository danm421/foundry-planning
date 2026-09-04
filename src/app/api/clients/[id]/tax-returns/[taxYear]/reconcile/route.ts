import { NextRequest, NextResponse } from "next/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { parseYear } from "@/lib/tax-returns/assemble-analysis";
import { computeReconciliation } from "@/lib/tax-reconciliation/reconcile";

export const dynamic = "force-dynamic";

export const LOAD_FAILURE_STATUS = { not_found: 404, facts_unreadable: 409, no_plan: 409 } as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; taxYear: string }> }) {
  try {
    await requireOrgId();
    const { id, taxYear: rawYear } = await params;
    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });
    const access = await verifyClientAccess(id);
    if (!access.ok) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const r = await computeReconciliation(id, access.firmId, taxYear);
    if (!r.ok) return NextResponse.json({ error: r.code, message: r.message }, { status: LOAD_FAILURE_STATUS[r.code] });
    return NextResponse.json({ reconciliation: r.reconciliation });
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("GET …/reconcile error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
