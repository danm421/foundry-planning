// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(clientId) / requireOrgId; the literal getOrgId/requireOrgId grep doesn't see this.

import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, intakeForms, intakeEmailSettings } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { clerkInviteErrorResponse } from "@/lib/clients/portal-invite-errors";
import { checkPortalInviteRateLimit } from "@/lib/rate-limit";
import { sendPortalInvite } from "@/lib/clients/send-portal-invite";
import { sendIntakeFormEmail } from "@/lib/intake/email";
import { getAdvisorProfile } from "@/lib/branding/advisor-profile";
import { resolveFirmName } from "@/lib/activity/resolve-firm-names";
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

    if (mode === "blank") {
      const link = `${APP_URL}/intake/${token}`;
      const firmName = await resolveFirmName(firmId);
      const advisor = await currentUser();
      const advisorName =
        [advisor?.firstName, advisor?.lastName].filter(Boolean).join(" ") ||
        undefined;
      const advisorEmail = advisor?.primaryEmailAddress?.emailAddress ?? undefined;

      const [settings] = await db
        .select()
        .from(intakeEmailSettings)
        .where(and(eq(intakeEmailSettings.firmId, firmId), eq(intakeEmailSettings.userId, userId)));

      // Brand resolves by the CLIENT's advisor, not the sender (matches Tasks
      // 11/12). A blank invite carrying no clientId falls back to the sender.
      const advisorUserId = accessedClient?.advisorId ?? userId;
      const advisorProfile = await getAdvisorProfile(firmId, advisorUserId);

      // Per-field fall-through, brand wins: a blank/unset brand field must
      // never clobber a working intake_email_settings value, so trim-then-
      // truthy rather than `??` (a stored "" would otherwise win — see Task 10).
      const brandFromName = advisorProfile?.brandingEnabled
        ? advisorProfile.emailFromName?.trim() || undefined
        : undefined;
      const brandReplyTo = advisorProfile?.brandingEnabled
        ? advisorProfile.emailReplyTo?.trim() || undefined
        : undefined;

      await sendIntakeFormEmail({
        to: recipientEmail,
        link,
        fromName: brandFromName ?? settings?.fromName ?? undefined,
        replyTo: brandReplyTo,
        subject: settings?.subject ?? undefined,
        introBody: settings?.introBody ?? undefined,
        advisorName,
        advisorEmail,
        firmName,
        clientName: recipientNameStr,
      });
    } else {
      // prefilled — send portal invite unless client is already bound
      const [clientRow] = await db
        .select({ clerkUserId: clients.clerkUserId })
        .from(clients)
        // firm-scoped belt-and-suspenders (requireClientEditAccess already verified ownership)
        .where(and(eq(clients.id, clientIdStr!), eq(clients.firmId, firmId)));

      if (!clientRow?.clerkUserId) {
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
                warning: clerkRes.error,
              },
              { status: 200 },
            );
          }
          // Non-Clerk error: re-throw so the outer catch handles it.
          throw inviteErr;
        }
      }
      // If clerkUserId is set the client is already bound — skip the invite.
    }

    // ── Audit ──────────────────────────────────────────────────────────────
    await recordAudit({
      action: "intake.form.sent",
      resourceType: "intake_form",
      resourceId: formId,
      clientId: clientIdStr ?? null,
      firmId,
    });

    return NextResponse.json({
      ok: true,
      formId,
      token,
      ...(invitationId ? { invitationId } : {}),
    });
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
