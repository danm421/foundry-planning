// @allow-firm-scope-exception — firm scoping enforced by loadFormForFirm(id, orgId); literal getOrgId/requireOrgId grep doesn't see it.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { loadFormForFirm } from "@/lib/intake/queries";
import { defaultExpiry } from "@/lib/intake/tokens";
import { resolveFormLink } from "@/lib/intake/form-link";
import { sendIntakeLinkEmail } from "@/lib/intake/send-form-email";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Send a submitted form back to the client so they can add to it. The payload
 * is kept, so the wizard opens on their own answers; `submittedAt` is cleared
 * because the detail page reads it as "there is a submission to review".
 * Resubmitting stamps it again and re-notifies the advisor.
 *
 * Only `submitted`: an applied form's answers are already in the plan, and
 * applying a second time would add every account and income row again — the
 * honest path there is a new pre-filled form, which starts from the plan.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { orgId, userId } = await requireOrgAndUser();
    const { id } = await ctx.params;

    const form = await loadFormForFirm(id, orgId);
    if (!form) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (form.status !== "submitted") {
      return NextResponse.json({ error: notReopenable(form.status) }, { status: 409 });
    }

    await requireActiveSubscriptionForFirm(orgId);

    // A fresh 30 days: the client asked to add something, and a form submitted
    // on day 29 would otherwise reopen onto a link that dies tomorrow.
    //
    // Conditional on still being `submitted`, so a reopen racing an Apply in
    // another tab cannot pull an applied form back to draft.
    const now = new Date();
    const reopened = await db
      .update(intakeForms)
      .set({ status: "draft", submittedAt: null, expiresAt: defaultExpiry(now), updatedAt: now })
      .where(
        and(
          eq(intakeForms.id, form.id),
          eq(intakeForms.firmId, orgId),
          eq(intakeForms.status, "submitted"),
        ),
      )
      .returning({ id: intakeForms.id });
    if (reopened.length === 0) {
      return NextResponse.json(
        { error: "This form changed a moment ago. Reload the page and try again." },
        { status: 409 },
      );
    }

    await recordAudit({
      action: "intake.form.reopened",
      resourceType: "intake_form",
      resourceId: form.id,
      clientId: form.clientId ?? null,
      firmId: orgId,
    });

    // Tell them it's open. Unlike Remind, a failed mail does not fail the
    // request — the form IS reopened, and the advisor can send the link with
    // Remind from the queue. `delivered` says which happened.
    const { link, brandAdvisorUserId } = await resolveFormLink(form, orgId, userId);
    const mail = link
      ? await sendIntakeLinkEmail({
          firmId: orgId,
          senderUserId: userId,
          brandAdvisorUserId,
          to: form.recipientEmail,
          link,
          clientName: form.recipientName,
          followUp: "reopened",
        })
      : { delivered: false };

    return NextResponse.json({ ok: true, delivered: mail.delivered });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) {
      return NextResponse.json(authErr.body, { status: authErr.status });
    }
    console.error("POST /api/data-collection/[id]/reopen error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function notReopenable(status: string): string {
  switch (status) {
    case "draft":
      return "This form is already open for the client.";
    case "applied":
      return "This form is already in the plan. Send a new form to collect more.";
    default:
      return `This form was ${status}. Send a new form instead.`;
  }
}
