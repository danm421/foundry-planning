// Abandons the client's live divorce draft (status: draft -> abandoned).
// Thin wrapper over abandonDraft (src/lib/divorce/divorce-plans.ts) — a
// subsequent GET on the parent route 404s with { error: "no_draft" } until a
// new draft is created.
//
// Auth preamble copied from src/app/api/clients/[id]/family-members/route.ts
// mutation shape: requireOrgAndUser() + requireClientEditAccess() +
// requireActiveSubscriptionForFirm().
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { abandonDraft, DivorcePlanError } from "@/lib/divorce/divorce-plans";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await requireOrgAndUser();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    await abandonDraft({ clientId: id, firmId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    if (err instanceof DivorcePlanError) {
      return NextResponse.json({ error: err.code, code: err.code }, { status: 422 });
    }
    console.error("POST /api/clients/[id]/divorce-plan/abandon error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
