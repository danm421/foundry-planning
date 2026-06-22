// @allow-firm-scope-exception — firm scoping enforced by loadFormForFirm(id, orgId); literal getOrgId/requireOrgId grep doesn't see it.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { loadFormForFirm } from "@/lib/intake/queries";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { orgId } = await requireOrgAndUser();
    const { id } = await ctx.params;

    const form = await loadFormForFirm(id, orgId);
    if (!form) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (form.status !== "draft") {
      return NextResponse.json(
        { error: "Only a draft form can be revoked" },
        { status: 409 },
      );
    }

    await db
      .update(intakeForms)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(intakeForms.id, id));

    await recordAudit({
      action: "intake.form.revoked",
      resourceType: "intake_form",
      resourceId: id,
      clientId: form.clientId ?? null,
      firmId: orgId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) {
      return NextResponse.json(authErr.body, { status: authErr.status });
    }
    console.error("[revoke route]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
