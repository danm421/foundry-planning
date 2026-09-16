// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(clientId) / requireOrgId; the literal getOrgId/requireOrgId grep doesn't see this.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, intakeForms } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import {
  requireActiveSubscriptionForFirm,
  requireClientPortalEntitlement,
  requireClientPortalForAdvisor,
  authErrorResponse,
} from "@/lib/authz";
import {
  clerkInviteErrorResponse,
  isExistingAccountError,
} from "@/lib/clients/portal-invite-errors";
import { resolveClientPortalUserId } from "@/lib/portal/bindings";
import { checkPortalInviteRateLimit } from "@/lib/rate-limit";
import { sendPortalInvite } from "@/lib/clients/send-portal-invite";
import { sendIntakeLinkEmail } from "@/lib/intake/send-form-email";
import type { IntakeEmailResult } from "@/lib/intake/email";
import { newIntakeToken, defaultExpiry } from "@/lib/intake/tokens";
import { EMAIL_RE, normalizeRecipientName } from "@/lib/intake/schema";
import {
  normalizeSections,
  forceFamilyForProspect,
  portalCollectsNothing,
  type IntakeSectionKey,
} from "@/lib/intake/sections";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";

/**
 * What to tell the advisor when the form was created but the mail wasn't sent.
 * Splits `unconfigured` out the way the reminder route does: on an environment
 * with no Resend key that is not an outage, and saying so stops the advisor
 * chasing a delivery problem that does not exist.
 */
function undeliveredWarning(
  mode: "blank" | "prefilled",
  to: string,
  reason: IntakeEmailResult["reason"],
): string {
  const waiting =
    mode === "prefilled"
      ? "The form is waiting in the portal"
      : "The form was created";
  return reason === "unconfigured"
    ? `${waiting}, but email isn't configured on this environment, so nothing was sent to ${to}.`
    : `${waiting}, but we couldn't email ${to} to tell them. Try sending a reminder from the queue.`;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mode?: unknown;
      clientId?: unknown;
      recipientEmail?: unknown;
      recipientName?: unknown;
      sections?: unknown;
    };

    // ── Validate body ──────────────────────────────────────────────────────
    const { mode, clientId, recipientEmail, recipientName, sections } = body;

    if (mode !== "blank" && mode !== "prefilled") {
      return NextResponse.json(
        { error: "mode must be 'blank' or 'prefilled'" },
        { status: 400 },
      );
    }

    if (
      typeof recipientEmail !== "string" ||
      !EMAIL_RE.test(recipientEmail)
    ) {
      return NextResponse.json(
        { error: "Valid recipientEmail required" },
        { status: 400 },
      );
    }

    if (mode === "prefilled" && !clientId) {
      return NextResponse.json(
        { error: "clientId is required for prefilled mode" },
        { status: 400 },
      );
    }

    const recipientNameStr = normalizeRecipientName(recipientName);
    const clientIdStr =
      typeof clientId === "string" ? clientId : undefined;

    // ── Sections ───────────────────────────────────────────────────────────
    // Absent means "use the default", which is stored as NULL — never as an
    // explicit copy of DEFAULT_INTAKE_SECTIONS, so a later change to the
    // default doesn't require rewriting rows that never customized anything.
    //
    // A caller that DID send something gets it normalized (canonical order,
    // de-duplicated, unknown keys dropped) and then family-forced when the send
    // has no clientId. An empty result means the request asked for a form that
    // collects nothing — a bug, not a preference.
    let sectionsToStore: IntakeSectionKey[] | null = null;
    if (sections !== undefined) {
      const normalized = normalizeSections(sections);
      if (normalized.length === 0) {
        return NextResponse.json(
          { error: "A form must collect at least one section" },
          { status: 400 },
        );
      }
      sectionsToStore = forceFamilyForProspect(normalized, Boolean(clientIdStr));
    }

    // A prefilled send is delivered as a portal invite and nothing else: no
    // token email, and the advisor UI never surfaces the token. The portal
    // wizard is the one host with no upload surface, so a documents-only form
    // there renders nothing, the page bounces the client to the Organizer, and
    // the request sits in draft forever having never been mentioned to anyone.
    // Refused at WRITE time, the same way Family is forced for a prospect —
    // the alternative is persisting a form that cannot be delivered.
    if (mode === "prefilled" && portalCollectsNothing(sectionsToStore)) {
      return NextResponse.json(
        {
          error:
            "A portal request can't collect documents only — the portal has no upload step. Send it as an email link instead, or include another step.",
        },
        { status: 400 },
      );
    }

    // ── Auth ───────────────────────────────────────────────────────────────
    const { orgId, userId } = await requireOrgAndUser();

    let firmId: string;
    const callerOrg: string = orgId;
    let access: "own" | "shared" = "own";
    // Captured for the blank branch's advisor-brand resolution below — the
    // client's advisor, not the sender, is who a brand resolves by.
    let accessedClient: typeof clients.$inferSelect | undefined;

    if (clientIdStr) {
      const acc = await requireClientEditAccess(clientIdStr);
      firmId = acc.firmId;
      access = acc.access;
      accessedClient = acc.client;
    } else {
      firmId = orgId;
    }

    await requireActiveSubscriptionForFirm(firmId);

    // ── Rate-limit (prefilled only) ────────────────────────────────────────
    if (mode === "prefilled") {
      // A prefilled send is delivered AS a portal invite (see below), so it is
      // the second way to grant portal access and needs the same entitlement as
      // /portal/invite — including that route's second check: the HOUSEHOLD'S
      // OWN advisor must be entitled, since sign-in resolves against
      // `clients.advisor_id` and not against the sender. Prefilled always
      // carries a clientId (validated above), so a missing row here is a
      // malformed request and fails closed on the blank advisorId. A blank
      // send is a tokenized email link — not gated.
      await requireClientPortalEntitlement(firmId);
      await requireClientPortalForAdvisor(firmId, accessedClient?.advisorId ?? "");
      const limit = await checkPortalInviteRateLimit(firmId);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Rate limit exceeded", reason: limit.reason },
          { status: 429 },
        );
      }
    }

    // ── Insert form ────────────────────────────────────────────────────────
    const now = new Date();
    const token = newIntakeToken();
    const expiresAt = defaultExpiry(now);

    const [form] = await db
      .insert(intakeForms)
      .values({
        firmId,
        clientId: clientIdStr ?? null,
        mode,
        token,
        recipientEmail,
        recipientName: recipientNameStr ?? null,
        sections: sectionsToStore,
        createdByUserId: userId,
        sentAt: now,
        expiresAt,
      })
      .returning({ id: intakeForms.id });

    const formId = form.id;

    // ── Send ───────────────────────────────────────────────────────────────
    let invitationId: string | undefined;
    /**
     * Whether mail actually left, on the two paths that send it — the naming
     * the rest of the app already uses for this fact (`IntakeEmailResult`,
     * /risk/send-rtq). Stays undefined on the invite path, where the Clerk
     * invitation is the delivery and `invitationId` reports it.
     */
    let mail: IntakeEmailResult | undefined;

    if (mode === "blank") {
      // Brand resolves by the CLIENT's advisor, not the sender (matches Tasks
      // 11/12). A blank invite carrying no clientId falls back to the sender.
      mail = await sendIntakeLinkEmail({
        firmId,
        senderUserId: userId,
        brandAdvisorUserId: accessedClient?.advisorId ?? userId,
        to: recipientEmail,
        link: `${APP_URL}/intake/${token}`,
        clientName: recipientNameStr,
      });
    } else {
      // prefilled — send portal invite unless client is already bound
      const [clientRow] = await db
        .select({ clerkUserId: clients.clerkUserId })
        .from(clients)
        // firm-scoped belt-and-suspenders (requireClientEditAccess already verified ownership)
        .where(and(eq(clients.id, clientIdStr!), eq(clients.firmId, firmId)));

      // DEPLOY-1 DUAL-READ. A client who ACCEPTED an access request has a
      // `portal_bindings` row and no `clients.clerk_user_id` at all, so the
      // legacy column alone re-invites somebody who already has access. The
      // resolver also answers null for a household whose access was REVOKED —
      // that column survives a revoke by design, and trusting it here would
      // skip the invite for a client who can no longer sign in, leaving the
      // form somewhere they cannot reach. Removed in Task 15.
      const boundClerkUserId = await resolveClientPortalUserId(
        clientIdStr!,
        clientRow?.clerkUserId ?? null,
      );

      if (!boundClerkUserId) {
        // Not yet bound — send invite (Clerk dup errors are non-fatal here:
        // the form already exists and is the primary artifact; the client
        // can reach it once signed in through other means).
        try {
          const result = await sendPortalInvite({
            clientId: clientIdStr!,
            email: recipientEmail,
            firmId,
            callerOrg,
            access,
          });
          invitationId = result.invitationId;
        } catch (inviteErr) {
          // Map Clerk dup-email errors to a 200-with-warning: the form was
          // created successfully and is the primary artifact. The advisor
          // should know the invite wasn't re-sent (already invited / already
          // has an account), but we don't roll back the form row.
          const clerkRes = clerkInviteErrorResponse(inviteErr);
          if (clerkRes) {
            // The shared copy tells the advisor a button will offer to send an
            // access request instead. That button lives on the Access tab; this
            // advisor is on the intake form, which has no such button — so this
            // caller says where to find it rather than pointing at thin air.
            const warning = isExistingAccountError(inviteErr)
              ? `The form was sent, but ${recipientEmail} already has a Foundry ` +
                `account, so no portal invitation went out. Open the Access tab on ` +
                `this page to send them an access request — only they can approve it.`
              : clerkRes.error;

            await recordAudit({
              action: "intake.form.sent",
              resourceType: "intake_form",
              resourceId: formId,
              clientId: clientIdStr ?? null,
              firmId,
            });
            return NextResponse.json(
              {
                ok: true,
                formId,
                token,
                warning,
              },
              { status: 200 },
            );
          }
          // Non-Clerk error: re-throw so the outer catch handles it.
          throw inviteErr;
        }
      } else {
        // A bound client needs no invite — but silence is not a delivery. The
        // portal only surfaces the form once they sign in, and nothing prompts
        // them to: before this, a pre-filled send to an existing portal user
        // mailed them nothing at all and sat in draft until they happened to
        // log in. Same mail the reminder sends, pointing at the portal rather
        // than minting a token this mode deliberately never surfaces.
        mail = await sendIntakeLinkEmail({
          firmId,
          senderUserId: userId,
          brandAdvisorUserId: accessedClient?.advisorId ?? userId,
          to: recipientEmail,
          link: `${APP_URL}/portal/intake`,
          clientName: recipientNameStr,
        });
      }
    }

    // ── Audit ──────────────────────────────────────────────────────────────
    // `delivered` rides in metadata (the /risk/send-rtq convention): the row is
    // otherwise identical whether or not anyone was actually told, and that is
    // the first thing you want when a client says they never got it.
    await recordAudit({
      action: "intake.form.sent",
      resourceType: "intake_form",
      resourceId: formId,
      clientId: clientIdStr ?? null,
      firmId,
      ...(mail ? { metadata: { delivered: mail.delivered } } : {}),
    });

    // The form row is the primary artifact and exists either way, so mail that
    // never left is a warning rather than an error — but the advisor has to
    // know the client was never told, on BOTH sending paths.
    const result: Record<string, unknown> = { ok: true, formId, token };
    if (invitationId) result.invitationId = invitationId;
    if (mail) {
      result.delivered = mail.delivered;
      if (!mail.delivered) {
        result.warning = undeliveredWarning(mode, recipientEmail, mail.reason);
      }
    }
    return NextResponse.json(result);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    const clerkRes = clerkInviteErrorResponse(err);
    if (clerkRes) {
      return NextResponse.json({ error: clerkRes.error }, { status: clerkRes.status });
    }
    console.error("POST /api/data-collection error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
