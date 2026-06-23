// @allow-firm-scope-exception — firm scoping enforced by loadFormForFirm(id, orgId); literal getOrgId/requireOrgId grep doesn't see it.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { loadFormForFirm } from "@/lib/intake/queries";
import { isOpenStatus } from "@/lib/intake/tokens";
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

    // Only an open form (draft or submitted) can be discarded. Re-discarding a
    // terminal form (applied/discarded/expired) is a no-op that would emit a
    // spurious audit + bump updatedAt, so reject it.
    if (!isOpenStatus(form.status)) {
      const reason =
        form.status === "applied"
          ? "Cannot discard an applied form — its data is live"
          : `Form is already ${form.status}`;
      return NextResponse.json({ error: reason }, { status: 409 });
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
