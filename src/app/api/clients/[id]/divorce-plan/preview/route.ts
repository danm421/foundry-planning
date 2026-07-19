// Read-only commit preview for the draft workbench — recomputes what a
// commit would do (Task 7's buildCommitPreview: blockers, per-object actions,
// straddle/link warnings, cleanup checklist, informational notes) without
// mutating anything. POST only: it's a computation over live planning data,
// not a resource fetch, and nothing here is cached.
//
// Access gate deliberately differs from the sibling mutation routes in this
// directory: it requires EDIT-level access (same as requireClientEditAccess)
// since the preview previews an eventual commit, but — because it never
// writes anything — it uses the same existence-hiding 404 the parent GET
// route uses (verifyClientAccess) rather than the mutation routes' 403, so a
// caller with no access at all can't distinguish "not found" from "found but
// view-only".
import { NextRequest, NextResponse } from "next/server";
import { verifyClientAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { buildCommitPreview } from "@/lib/divorce/commit-preview";
import { DivorcePlanError } from "@/lib/divorce/divorce-plans";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok || access.permission !== "edit") {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    await requireActiveSubscriptionForFirm(access.firmId);

    const preview = await buildCommitPreview({ clientId: id, firmId: access.firmId });
    return NextResponse.json(preview);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    // no_draft is the expected steady-state before a draft exists (or after
    // it's abandoned) — surface as 404, same as the parent GET route, since
    // there's nothing to preview yet.
    if (err instanceof DivorcePlanError && err.code === "no_draft") {
      return NextResponse.json({ error: "no_draft" }, { status: 404 });
    }
    if (err instanceof DivorcePlanError) {
      return NextResponse.json({ error: err.code, code: err.code }, { status: 422 });
    }
    console.error("POST /api/clients/[id]/divorce-plan/preview error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
