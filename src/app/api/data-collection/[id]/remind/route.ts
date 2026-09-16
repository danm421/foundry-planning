// @allow-firm-scope-exception — firm scoping enforced by loadFormForFirm(id, orgId); literal getOrgId/requireOrgId grep doesn't see it.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { loadFormForFirm } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import { sendIntakeLinkEmail } from "@/lib/intake/send-form-email";
import { resolveClientPortalUserId } from "@/lib/portal/bindings";
import { checkIntakeRemindRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";

/**
 * Nudge a recipient who hasn't finished their form: mail them the same access
 * link again, from the same composer the first send used.
 *
 * Deliberately non-mutating apart from the audit row — no new token, no new
 * expiry. A reminder that silently re-keyed the form would break the link the
 * client may already have open in another tab.
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

    // Only a form still out with the client. A submitted one is waiting on the
    // ADVISOR, and chasing the client for it would be the wrong message
    // entirely; applied/discarded/expired are terminal.
    if (form.status !== "draft") {
      return NextResponse.json(
        { error: "This form isn't waiting on the client any more." },
        { status: 409 },
      );
    }

    // Checked before sending, not after: the link in an expired form's mail
    // opens onto a dead end, so the honest answer is a fresh form.
    if (isExpired(form, new Date())) {
      return NextResponse.json(
        { error: "This form's link has expired. Send a new form instead." },
        { status: 409 },
      );
    }

    await requireActiveSubscriptionForFirm(orgId);

    const limit = await checkIntakeRemindRateLimit(form.id);
    if (!limit.allowed) {
      return rateLimitErrorResponse(
        limit,
        "You've already sent several reminders for this form. Try again tomorrow.",
      );
    }

    // One row, read at two call sites below: the brand the recipient sees, and
    // the legacy portal-login column. A prospect form has no client behind it.
    const [client] = form.clientId
      ? await db
          .select({ advisorId: clients.advisorId, clerkUserId: clients.clerkUserId })
          .from(clients)
          .where(and(eq(clients.id, form.clientId), eq(clients.firmId, orgId)))
      : [];

    // The household's own advisor owns the brand — same rule as the first send,
    // which resolves it off `requireClientEditAccess`; falls back to the sender.
    const brandAdvisorUserId = client?.advisorId ?? userId;

    // Where the client picks the form back up. A blank form travels on its own
    // token; a prefilled one lives behind the portal login, so the reminder
    // points at the portal rather than minting a second way in.
    let link: string;
    if (form.mode === "prefilled") {
      const boundClerkUserId = form.clientId
        ? await resolveClientPortalUserId(form.clientId, client?.clerkUserId ?? null)
        : null;

      // No login yet means there is no link to re-send — what's outstanding is
      // the Clerk invitation, which the Access tab owns. Saying so beats mailing
      // them a portal URL that can only bounce them to a sign-in they can't pass.
      if (!boundClerkUserId) {
        return NextResponse.json(
          {
            error:
              "They haven't set up their Foundry login yet. Resend the invitation from the Access tab on their portal page.",
          },
          { status: 409 },
        );
      }
      link = `${APP_URL}/portal/intake`;
    } else {
      link = `${APP_URL}/intake/${form.token}`;
    }

    const sent = await sendIntakeLinkEmail({
      firmId: orgId,
      senderUserId: userId,
      brandAdvisorUserId,
      to: form.recipientEmail,
      link,
      clientName: form.recipientName,
      reminder: true,
    });

    // The first send can shrug off a failed mail — the form row exists and the
    // advisor can copy the link. A reminder IS the mail, so a swallowed failure
    // would leave the advisor believing they'd chased someone they hadn't.
    if (!sent.delivered) {
      return NextResponse.json(
        {
          error:
            sent.reason === "unconfigured"
              ? "Email isn't configured on this environment, so no reminder was sent."
              : "We couldn't send the reminder. Try again in a moment.",
        },
        { status: 502 },
      );
    }

    // Written only on a real send — this row is what the queue reads back as
    // "Reminded <date>", so an audit for mail that never left would be a lie
    // the advisor acts on.
    await recordAudit({
      action: "intake.form.reminded",
      resourceType: "intake_form",
      resourceId: form.id,
      clientId: form.clientId ?? null,
      firmId: orgId,
    });

    return NextResponse.json({ ok: true, remindedAt: new Date().toISOString() });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) {
      return NextResponse.json(authErr.body, { status: authErr.status });
    }
    console.error("POST /api/data-collection/[id]/remind error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
