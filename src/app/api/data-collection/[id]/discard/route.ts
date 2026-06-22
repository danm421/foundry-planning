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

    if (form.status === "applied") {
      return NextResponse.json(
        { error: "Cannot discard an applied form — its data is live" },
        { status: 409 },
      );
    }

    await db
      .update(intakeForms)
      .set({ status: "discarded", updatedAt: new Date() })
      .where(eq(intakeForms.id, id));

    await recordAudit({
      action: "intake.form.discarded",
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
    console.error("[discard route]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
