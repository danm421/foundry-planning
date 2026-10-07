// @allow-firm-scope-exception — firm and book scoping enforced by loadFormForCaller(id, orgId); literal getOrgId/requireOrgId grep doesn't see it.

import { NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { uuidRegex } from "@/lib/schemas/common";
import { loadFormForCaller } from "@/lib/intake/form-access";
import { applyIntake } from "@/lib/intake/apply";
import { linkIntakeFormToClient } from "@/lib/intake/link-client";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { orgId, userId } = await requireOrgAndUser();
    // Apply materializes staged intake into the live client/household — a
    // billable write. Gate on an active subscription (unlike discard/revoke,
    // which only flip the form's status and are allowlisted in the lint).
    await requireActiveSubscriptionForFirm(orgId);
    const { id } = await ctx.params;

    const form = await loadFormForCaller(id, orgId);
    if (!form) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Optional `clientId`: apply a new-household form to a client the advisor
    // already has, instead of creating a second one.
    const body = (await req.json().catch(() => ({}))) as { clientId?: unknown };
    if (body.clientId !== undefined) {
      if (typeof body.clientId !== "string" || !uuidRegex.test(body.clientId)) {
        return NextResponse.json({ error: "clientId must be a client id" }, { status: 400 });
      }
      await requireClientEditAccess(body.clientId);
      const linked = await linkIntakeFormToClient({
        formId: id,
        firmId: orgId,
        clientId: body.clientId,
        actorId: userId,
      });
      if (linked === "form_not_found" || linked === "client_not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (linked === "conflict") {
        return NextResponse.json(
          { error: "Only a submitted form for a new household can be linked to a client" },
          { status: 409 },
        );
      }
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
