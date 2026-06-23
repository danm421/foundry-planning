// @allow-firm-scope-exception — firm scoping enforced by loadFormForFirm(id, orgId); literal getOrgId/requireOrgId grep doesn't see it.

import { NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { loadFormForFirm } from "@/lib/intake/queries";
import { applyIntake } from "@/lib/intake/apply";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { orgId, userId } = await requireOrgAndUser();
    // Apply materializes staged intake into the live client/household — a
    // billable write. Gate on an active subscription (unlike discard/revoke,
    // which only flip the form's status and are allowlisted in the lint).
    await requireActiveSubscriptionForFirm(orgId);
    const { id } = await ctx.params;

    const form = await loadFormForFirm(id, orgId);
    if (!form) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { clientId } = await applyIntake({ formId: id, firmId: orgId, actorId: userId });

    return NextResponse.json({ ok: true, clientId });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) {
      return NextResponse.json(authErr.body, { status: authErr.status });
    }
    console.error("[apply route]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
