// Executes the divorce-commit engine (src/lib/divorce/commit-divorce-plan.ts):
// mints the spouse (S) household + client, moves/duplicates allocated
// objects, cleans up the original (P) side, and flips the draft to
// committed. One-way — there is no undo; the engine leaves a "Pre-divorce
// baseline" scenario snapshot on P for manual reference only.
//
// Access gate mirrors the preview route (Task 8's binding decision), not the
// sibling mutation routes in this directory: existence-hiding 404 via
// verifyClientAccess gated on permission === 'edit', rather than the 403
// requireClientEditAccess throws — a caller with no access at all can't
// distinguish "not found" from "found but view-only". POST only: committing
// is a one-shot action, not a resource create/update in the REST sense.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { verifyClientAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";
import { commitDivorcePlan, DivorceCommitError } from "@/lib/divorce/commit-divorce-plan";

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

    const { userId } = await auth();
    if (!userId) throw new UnauthorizedError();

    const result = await commitDivorcePlan({ clientId: id, firmId: access.firmId, userId });
    return NextResponse.json(result);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    if (err instanceof DivorceCommitError) {
      // no_draft: no live draft to commit (or the client is missing) — same
      // steady-state 404 the parent GET/preview routes use.
      if (err.code === "no_draft") {
        return NextResponse.json({ error: "no_draft" }, { status: 404 });
      }
      // blocked: buildCommitPreview found unresolved preconditions — surface
      // the checklist so the UI can render it (mirrors the preview payload's
      // blockers shape).
      if (err.code === "blocked") {
        return NextResponse.json({ error: "blocked", blockers: err.blockers ?? [] }, { status: 422 });
      }
      // concurrent: another commit won the race inside the tx-scoped guard.
      if (err.code === "concurrent") {
        return NextResponse.json({ error: "concurrent" }, { status: 409 });
      }
      // unresolvable_measuring_life: an engine-level failure discovered only
      // at commit (a life-based CRT's measuring life can't reach the spouse
      // side). Same 422 convention the sibling routes use for
      // DivorcePlanError/AllocationError; err.message carries the actionable
      // detail (which trust, why) the UI should surface verbatim.
      return NextResponse.json(
        { error: err.code, code: err.code, message: err.message },
        { status: 422 }
      );
    }
    console.error("POST /api/clients/[id]/divorce-plan/commit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
